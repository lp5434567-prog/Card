CREATE TABLE IF NOT EXISTS users (
 id SERIAL PRIMARY KEY,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 full_name TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin','super_admin')),
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','pending')),
 kyc_status TEXT NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending','approved','rejected')),
 aml_status TEXT NOT NULL DEFAULT 'pending' CHECK (aml_status IN ('pending','cleared','review')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS licenses (
 id SERIAL PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended','expired')),
 license_number TEXT,
 licensed_entity_name TEXT,
 jurisdiction TEXT NOT NULL DEFAULT 'HU',
 effective_date DATE,
 expiry_date DATE,
 permitted_products JSONB NOT NULL DEFAULT '[]',
 provider_name TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cards (
 id SERIAL PRIMARY KEY,
 user_id INT NOT NULL REFERENCES users(id),
 provider_card_id TEXT,
 card_type TEXT NOT NULL DEFAULT 'virtual',
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','frozen','closed')),
 last4 TEXT,
 credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
 available_credit NUMERIC(14,2) NOT NULL DEFAULT 0,
 currency TEXT NOT NULL DEFAULT 'EUR',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
 id SERIAL PRIMARY KEY,
 user_id INT NOT NULL REFERENCES users(id),
 card_id INT REFERENCES cards(id),
 type TEXT NOT NULL CHECK (type IN ('purchase','payment','cash_advance','refund','fee','adjustment')),
 amount NUMERIC(14,2) NOT NULL,
 currency TEXT NOT NULL DEFAULT 'EUR',
 status TEXT NOT NULL DEFAULT 'pending',
 merchant TEXT,
 reference TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_cases (
 id SERIAL PRIMARY KEY,
 user_id INT NOT NULL REFERENCES users(id),
 case_type TEXT NOT NULL CHECK (case_type IN ('kyc','aml','sanctions','transaction_review')),
 status TEXT NOT NULL DEFAULT 'open',
 notes TEXT,
 assigned_to INT REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
 id SERIAL PRIMARY KEY,
 actor_user_id INT REFERENCES users(id),
 action TEXT NOT NULL,
 target_type TEXT,
 target_id TEXT,
 details JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO licenses(status, jurisdiction, permitted_products)
SELECT 'pending','HU','[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM licenses);
