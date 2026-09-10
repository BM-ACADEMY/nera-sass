DO $$
DECLARE
  default_tenant_id BIGINT;
BEGIN
  -- Get the ID of the default tenant we just created
  SELECT id INTO default_tenant_id FROM tenants ORDER BY id ASC LIMIT 1;
  
  IF default_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Default tenant not found. Cannot run multi-tenancy migrations.';
  END IF;

  -- 1. alliance_campaigns
  ALTER TABLE alliance_campaigns ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
  UPDATE alliance_campaigns SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  ALTER TABLE alliance_campaigns ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE alliance_campaigns ADD CONSTRAINT fk_alliance_campaigns_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

  -- 2. alliance_prospects
  ALTER TABLE alliance_prospects ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
  UPDATE alliance_prospects SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  ALTER TABLE alliance_prospects ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE alliance_prospects ADD CONSTRAINT fk_alliance_prospects_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

  -- 3. alliance_numbers
  ALTER TABLE alliance_numbers ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
  UPDATE alliance_numbers SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  ALTER TABLE alliance_numbers ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE alliance_numbers ADD CONSTRAINT fk_alliance_numbers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

  -- 4. alliance_domains
  ALTER TABLE alliance_domains ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
  UPDATE alliance_domains SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  ALTER TABLE alliance_domains ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE alliance_domains ADD CONSTRAINT fk_alliance_domains_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

  -- 5. alliance_replies
  ALTER TABLE alliance_replies ADD COLUMN IF NOT EXISTS tenant_id BIGINT;
  UPDATE alliance_replies SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  ALTER TABLE alliance_replies ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE alliance_replies ADD CONSTRAINT fk_alliance_replies_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

END $$;
