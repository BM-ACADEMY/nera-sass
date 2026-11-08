-- Migration 037 (reference only). The application runs on MongoDB; the live
-- migration is 037_billing_plans_subscriptions_wallet.js. This file documents
-- the same tables for anyone reading the SQL history.

CREATE TABLE IF NOT EXISTS plans (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,              -- desk | whatsapp | complete
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_inr NUMERIC(12,2) NOT NULL,              -- rupees a month
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
  ai_replies_month INTEGER NOT NULL DEFAULT 0,   -- -1 = no limit
  ai_overage_price_paise INTEGER NOT NULL DEFAULT 0,
  seats_included INTEGER NOT NULL DEFAULT 1,
  numbers_included INTEGER NOT NULL DEFAULT 1,
  extra_seat_price_inr NUMERIC(12,2) NOT NULL DEFAULT 0,
  extra_number_price_inr NUMERIC(12,2) NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO plans (code, name, price_inr, ai_replies_month, ai_overage_price_paise, seats_included, numbers_included, extra_seat_price_inr, extra_number_price_inr, sort_order)
VALUES
  ('desk',     'Desk',     799,  200,  100, 1, 1, 299, 499, 1),
  ('whatsapp', 'WhatsApp', 1999, 1000, 100, 2, 1, 299, 499, 2),
  ('complete', 'Complete', 3999, 3000, 100, 5, 2, 299, 499, 3)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id BIGINT NOT NULL REFERENCES plans(id),
  plan_code VARCHAR(40) NOT NULL,
  plan_name VARCHAR(120) NOT NULL,
  price_inr NUMERIC(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  extra_seats INTEGER NOT NULL DEFAULT 0,
  extra_numbers INTEGER NOT NULL DEFAULT 0,
  razorpay_order_id VARCHAR(64),
  razorpay_payment_id VARCHAR(64),
  activated_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status_end ON subscriptions (status, current_period_end);

-- Append-only: the application never updates or deletes a row; the balance is SUM(signed_paise).
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  direction VARCHAR(6) NOT NULL CHECK (direction IN ('credit','debit')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  signed_paise BIGINT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  reason VARCHAR(20) NOT NULL CHECK (reason IN ('topup','ai_overage','extra_seat','extra_number','adjustment','refund')),
  reference_type VARCHAR(40),
  reference_id VARCHAR(120),
  description VARCHAR(300) NOT NULL DEFAULT '',
  created_by BIGINT,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_ledger_reference ON wallet_ledger (tenant_id, reference_type, reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_tenant_created ON wallet_ledger (tenant_id, created_at);
REVOKE UPDATE, DELETE ON wallet_ledger FROM PUBLIC;

CREATE TABLE IF NOT EXISTS billing_orders (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('subscription','wallet_topup')),
  plan_id BIGINT REFERENCES plans(id),
  plan_code VARCHAR(40),
  amount_paise BIGINT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  razorpay_order_id VARCHAR(64) NOT NULL UNIQUE,
  razorpay_payment_id VARCHAR(64),
  status VARCHAR(20) NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','fulfilled','failed')),
  signature_verified_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  fulfilled_by VARCHAR(20),
  created_by BIGINT,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_orders_tenant_created ON billing_orders (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS billing_alerts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alert_key VARCHAR(160) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  message TEXT NOT NULL,
  delivered BOOLEAN NOT NULL DEFAULT FALSE,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, alert_key)
);
