# Private Credit Card & Compliance Architecture

A deployable starter application for a private credit-card/account platform.

## Included
- Customer registration/login
- Customer accounts and credit limits
- Virtual-card-style management UI
- Freeze/unfreeze card
- Transactions
- Admin and super-admin roles
- Licensing/compliance configuration
- KYC/AML status fields and review queue
- Transaction limits
- Audit log
- PostgreSQL schema
- Provider integration interface
- Docker setup

## Important
This software does NOT create a legal banking/card-issuing licence and does not itself move real money.
Live card issuance and credit require an appropriately licensed/regulated issuer or issuing partner,
plus contracts, KYC/AML controls, safeguarding/settlement arrangements where applicable, and production credentials.

The `license_status` gate defaults to `pending`. Card issuance and live credit operations are blocked
until an authorized administrator configures an approved licence/regulated-provider arrangement.

## Run
1. Copy `.env.example` to `.env`.
2. Run `docker compose up --build`.
3. Open http://localhost:3000

Default demo admin:
- email: admin@example.com
- password: ChangeMeImmediately!

Change demo credentials before any deployment.
