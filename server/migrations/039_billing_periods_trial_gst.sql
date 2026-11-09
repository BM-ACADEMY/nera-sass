-- Migration 039 (reference only). The application runs on MongoDB; the live
-- migration is 039_billing_periods_trial_gst.js. This file documents the same
-- changes for anyone reading the SQL history.

-- 1. Prepaid periods: table prices per period, GST added on top at order time.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS period_prices_inr JSONB NOT NULL DEFAULT '{}';
UPDATE plans SET period_prices_inr = '{"1": 799, "3": 2149, "6": 3799}'    WHERE code = 'desk'     AND period_prices_inr = '{}' AND price_inr = 799;
UPDATE plans SET period_prices_inr = '{"1": 1999, "3": 5399, "6": 9599}'   WHERE code = 'whatsapp' AND period_prices_inr = '{}' AND price_inr = 1999;
UPDATE plans SET period_prices_inr = '{"1": 3999, "3": 10799, "6": 19199}' WHERE code = 'complete' AND period_prices_inr = '{}' AND price_inr = 3999;
UPDATE plans SET period_prices_inr = jsonb_build_object('1', price_inr) WHERE period_prices_inr = '{}';

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS period_months INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subscriptions ALTER COLUMN plan_id DROP NOT NULL; -- a trial has no plan row

-- 2. GST: price, tax and total kept apart; amount_paise stays the charged total.
ALTER TABLE billing_orders
  ADD COLUMN IF NOT EXISTS period_months INTEGER,
  ADD COLUMN IF NOT EXISTS price_paise BIGINT,
  ADD COLUMN IF NOT EXISTS gst_rate_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paise BIGINT,
  ADD COLUMN IF NOT EXISTS invoice_id BIGINT;
UPDATE billing_orders SET price_paise = amount_paise, total_paise = amount_paise,
  period_months = CASE WHEN purpose = 'subscription' THEN 1 END WHERE total_paise IS NULL;

-- 3. One numbered tax invoice per payment.
CREATE TABLE IF NOT EXISTS billing_invoices (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number VARCHAR(40) NOT NULL UNIQUE,            -- GN-<year>-<six digits>
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  order_id BIGINT REFERENCES billing_orders(id),
  razorpay_order_id VARCHAR(64),
  razorpay_payment_id VARCHAR(64) NOT NULL,
  purpose VARCHAR(20) NOT NULL,                          -- subscription | wallet_topup
  customer_business_name VARCHAR(200) NOT NULL DEFAULT '',
  customer_email VARCHAR(200) NOT NULL DEFAULT '',
  plan_code VARCHAR(40),
  plan_name VARCHAR(120),
  period_months INTEGER,
  description VARCHAR(300) NOT NULL DEFAULT '',
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  price_paise BIGINT NOT NULL,
  gst_rate_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  gst_paise BIGINT NOT NULL DEFAULT 0,
  total_paise BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'paid',
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, razorpay_payment_id)
);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant_issued ON billing_invoices (tenant_id, issued_at);

-- 4. The free trial: one per workspace and one per business identity.
CREATE TABLE IF NOT EXISTS billing_trials (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  business_name VARCHAR(120) NOT NULL,
  website VARCHAR(300) NOT NULL,
  owner_email VARCHAR(200),
  phone VARCHAR(40),
  whatsapp_number VARCHAR(40),
  business_key VARCHAR(160) NOT NULL UNIQUE,
  website_key VARCHAR(255) UNIQUE,
  email_key VARCHAR(200) UNIQUE,
  phone_key VARCHAR(10) UNIQUE,
  whatsapp_key VARCHAR(10) UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','converted')),
  started_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  original_ends_at TIMESTAMPTZ NOT NULL,
  days INTEGER NOT NULL DEFAULT 7 CHECK (days BETWEEN 7 AND 14),
  ai_replies_total INTEGER NOT NULL DEFAULT 50,
  extensions JSONB NOT NULL DEFAULT '[]',                -- [{by, at, days, reason, ends_at}]
  day5_notice_at TIMESTAMPTZ,
  expiry_notice_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  created_by BIGINT,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_trials_status_end ON billing_trials (status, ends_at);

CREATE TABLE IF NOT EXISTS billing_trial_attempts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id BIGINT,
  business_name VARCHAR(200) NOT NULL DEFAULT '',
  website VARCHAR(300) NOT NULL DEFAULT '',
  matched TEXT[] NOT NULL DEFAULT '{}',
  reason VARCHAR(300) NOT NULL DEFAULT '',
  matched_tenant_id BIGINT,
  ip VARCHAR(64),
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_trial_attempts_tenant_created ON billing_trial_attempts (tenant_id, created_at);
