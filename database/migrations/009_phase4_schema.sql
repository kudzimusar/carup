-- =============================================================
-- PHASE 4 SCHEMA: Government OS & Mechanic OS
-- =============================================================

-- Agent 7: Government / ZIMRA OS
CREATE TABLE IF NOT EXISTS registry_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  verified_by TEXT REFERENCES users(id),
  verification_date TIMESTAMPTZ,
  notes TEXT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Draft', 'Submitted', 'Audited')),
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registry_verifications_vin ON registry_verifications(vin);
CREATE INDEX IF NOT EXISTS idx_registry_verifications_tenant ON registry_verifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_tenant ON compliance_reports(tenant_id);

-- Agent 8: PartSentry / Mechanic OS
CREATE TABLE IF NOT EXISTS mechanic_parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  stock_level INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 5,
  supplier TEXT,
  unit_price REAL NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS mechanic_work_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vin TEXT NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
  customer_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress', 'Completed', 'Cancelled')),
  description TEXT,
  labor_cost REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  mechanic_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mechanic_parts_tenant ON mechanic_parts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mechanic_work_orders_tenant ON mechanic_work_orders(tenant_id);

-- Row Level Security (RLS) policies can be omitted if queries are strictly verified on the backend, 
-- but ideally should enforce tenant isolation if Supabase API is called from the client.
-- (Currently we are handling this via Express Backend)
