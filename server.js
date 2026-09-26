const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const secret = process.env.SESSION_SECRET || 'dev-only-secret';

function sign(user) {
  return jwt.sign({ id:user.id, role:user.role }, secret, { expiresIn:'8h' });
}
function auth(req,res,next) {
  try {
    const token=req.cookies.session;
    if(!token) return res.status(401).json({error:'Authentication required'});
    req.user=jwt.verify(token,secret); next();
  } catch { res.status(401).json({error:'Invalid session'}); }
}
function admin(req,res,next) {
  if(!['admin','super_admin'].includes(req.user.role))
    return res.status(403).json({error:'Admin permission required'});
  next();
}
async function license() {
  const {rows}=await pool.query('SELECT * FROM licenses ORDER BY id LIMIT 1');
  return rows[0];
}
function liveOperationsAllowed(l) {
  return l && l.status === 'approved' && l.licensed_entity_name && l.license_number;
}

app.get('/api/health', async (_,res)=>{
  const l=await license();
  res.json({ok:true, license_status:l?.status || 'missing', live_operations_allowed:liveOperationsAllowed(l)});
});

app.post('/api/register', async (req,res)=>{
  const {email,password,full_name}=req.body;
  if(!email||!password||!full_name) return res.status(400).json({error:'Missing fields'});
  const hash=await bcrypt.hash(password,12);
  try {
    const {rows}=await pool.query(
      'INSERT INTO users(email,password_hash,full_name) VALUES($1,$2,$3) RETURNING id,email,full_name,role,status,kyc_status,aml_status',
      [email,hash,full_name]);
    res.status(201).json(rows[0]);
  } catch { res.status(409).json({error:'Email already registered'}); }
});

app.post('/api/login', async (req,res)=>{
  const {email,password}=req.body;
  const {rows}=await pool.query('SELECT * FROM users WHERE email=$1',[email]);
  const u=rows[0];
  if(!u || !(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:'Invalid credentials'});
  res.cookie('session',sign(u),{httpOnly:true,sameSite:'lax'});
  res.json({id:u.id,email:u.email,full_name:u.full_name,role:u.role,status:u.status});
});

app.post('/api/logout',(req,res)=>{res.clearCookie('session');res.json({ok:true});});

app.get('/api/me',auth,async(req,res)=>{
  const {rows}=await pool.query('SELECT id,email,full_name,role,status,kyc_status,aml_status FROM users WHERE id=$1',[req.user.id]);
  res.json(rows[0]);
});

app.get('/api/card',auth,async(req,res)=>{
  const {rows}=await pool.query('SELECT * FROM cards WHERE user_id=$1 ORDER BY id DESC LIMIT 1',[req.user.id]);
  res.json(rows[0]||null);
});

app.post('/api/card/issue',auth,async(req,res)=>{
  const l=await license();
  if(!liveOperationsAllowed(l)) return res.status(403).json({
    error:'Live card issuance is disabled until an approved licence/regulated issuer arrangement is configured.'
  });
  const u=(await pool.query('SELECT * FROM users WHERE id=$1',[req.user.id])).rows[0];
  if(u.kyc_status!=='approved'||u.aml_status!=='cleared')
    return res.status(403).json({error:'KYC/AML approval required'});
  const {rows}=await pool.query(
    `INSERT INTO cards(user_id,status,credit_limit,available_credit)
     VALUES($1,'pending',$2,$2) RETURNING *`,[req.user.id,Number(req.body.credit_limit||0)]);
  res.status(201).json(rows[0]);
});

app.post('/api/card/freeze',auth,async(req,res)=>{
  const {rows}=await pool.query(
    "UPDATE cards SET status='frozen' WHERE user_id=$1 AND status='active' RETURNING *",[req.user.id]);
  res.json(rows[0]||null);
});

app.get('/api/transactions',auth,async(req,res)=>{
  const {rows}=await pool.query(
    'SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.id]);
  res.json(rows);
});

app.get('/api/admin/overview',auth,admin,async(req,res)=>{
  const [u,c,t,a,l]=await Promise.all([
    pool.query('SELECT COUNT(*)::int count FROM users'),
    pool.query('SELECT COUNT(*)::int count FROM cards'),
    pool.query('SELECT COUNT(*)::int count FROM transactions'),
    pool.query('SELECT COUNT(*)::int count FROM compliance_cases WHERE status=$1',['open']),
    license()
  ]);
  res.json({users:u.rows[0].count,cards:c.rows[0].count,transactions:t.rows[0].count,open_compliance_cases:a.rows[0].count,license:l});
});

app.get('/api/admin/users',auth,admin,async(req,res)=>{
  const {rows}=await pool.query('SELECT id,email,full_name,role,status,kyc_status,aml_status,created_at FROM users ORDER BY created_at DESC');
  res.json(rows);
});

app.patch('/api/admin/users/:id',auth,admin,async(req,res)=>{
  const allowed=['status','role','kyc_status','aml_status'];
  const entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));
  if(!entries.length) return res.status(400).json({error:'No permitted fields'});
  const vals=entries.map(([,v])=>v); const sets=entries.map(([k],i)=>`${k}=$${i+1}`).join(',');
  vals.push(req.params.id);
  const {rows}=await pool.query(`UPDATE users SET ${sets} WHERE id=$${vals.length} RETURNING id,email,full_name,role,status,kyc_status,aml_status`,vals);
  await pool.query('INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
    [req.user.id,'admin_user_update','user',req.params.id,JSON.stringify(req.body)]);
  res.json(rows[0]);
});

app.get('/api/admin/license',auth,admin,async(req,res)=>res.json(await license()));

app.patch('/api/admin/license',auth,admin,async(req,res)=>{
  if(req.user.role!=='super_admin') return res.status(403).json({error:'Super-admin permission required'});
  const allowed=['status','license_number','licensed_entity_name','jurisdiction','effective_date','expiry_date','permitted_products','provider_name'];
  const entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));
  if(!entries.length) return res.status(400).json({error:'No permitted fields'});
  const vals=entries.map(([,v])=>v);
  const sets=entries.map(([k],i)=>`${k}=$${i+1}`).join(',');
  vals.push((await license()).id);
  const {rows}=await pool.query(`UPDATE licenses SET ${sets},updated_at=now() WHERE id=$${vals.length} RETURNING *`,vals);
  await pool.query('INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
    [req.user.id,'license_config_update','license',String(rows[0].id),JSON.stringify(req.body)]);
  res.json(rows[0]);
});

app.get('/api/admin/audit',auth,admin,async(req,res)=>{
  const {rows}=await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');
  res.json(rows);
});

app.listen(process.env.PORT||3000,()=>console.log('Credit platform running'));
