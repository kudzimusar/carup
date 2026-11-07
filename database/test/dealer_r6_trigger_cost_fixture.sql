-- R6 DBA #2 benchmark fixture: SYNTHETIC rows only, for a disposable PG17 (never a shared database).
-- 5,000 legacy (non-programme) tenants, 50,000 legacy vehicles (5% published), 5,000 legacy
-- memberships, 1,000 legacy dealer profiles; plus 100 programme dealers (the research seed universe
-- is at most 104 rows) with 4 VINs each, linked through dealer_approved_seed_links.
\set ON_ERROR_STOP 1
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant ON vehicles(tenant_id);  -- mirrors production 002_multi_tenant
INSERT INTO users(id,role,is_verified)
  SELECT 'bench-user-'||g,'member',false FROM generate_series(1,5100) g;
INSERT INTO tenants(id,name,type,status)
  SELECT ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'Legacy tenant '||g,
         (ARRAY['dealership','private','fleet'])[1+g%3],'active'
    FROM generate_series(1,5000) g;
INSERT INTO tenant_users(tenant_id,user_id,role)
  SELECT ('10000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'bench-user-'||g,'admin' FROM generate_series(1,5000) g;
INSERT INTO vehicles(vin,tenant_id,make,model,year,mileage,price,status,publication_status,current_seller_id)
  SELECT 'LEGACY'||lpad(g::text,11,'0'),('10000000-0000-4000-8000-'||lpad((1+g%5000)::text,12,'0'))::uuid,
         'Synthetic','Legacy',2015+g%10,g%200000,1000+g%50000,'Available',
         CASE WHEN g%20=0 THEN 'published' ELSE 'draft' END,'bench-user-'||(1+g%5000)
    FROM generate_series(1,50000) g;
INSERT INTO dealer_profiles(id,user_id,legal_name)
  SELECT ('30000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'bench-user-'||g,'Legacy dealer '||g FROM generate_series(1,1000) g;
-- 100 programme dealers. FK/trigger checks are bypassed ONLY for this synthetic load
-- (session_replication_role=replica) because a real activation needs the full governed flow.
SET session_replication_role = replica;
INSERT INTO tenants(id,name,type,status)
  SELECT ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'Programme dealer '||g,'dealership','active' FROM generate_series(1,100) g;
INSERT INTO tenant_users(tenant_id,user_id,role)
  SELECT ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'bench-user-'||(5000+g),'dealer' FROM generate_series(1,100) g;
INSERT INTO dealer_profiles(id,user_id,legal_name,identity_status,compliance_review_state,active_state,expiry_date)
  SELECT ('40000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'bench-user-'||(5000+g),'Programme dealer '||g,
         'verified','passed','active',now()+interval '300 days' FROM generate_series(1,100) g;
INSERT INTO organizations(id,name,type,created_at,tenant_id)
  SELECT 'bench-org-'||g,'Programme dealer '||g,'dealership',now()::text,('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid FROM generate_series(1,100) g;
INSERT INTO dealer_approved_seed_links(seed_dealer_id,claim_id,submission_id,legal_review_id,organization_id,tenant_id,
    dealer_profile_id,claimant_user_id,operating_status,activated_by)
  SELECT 'ZW-DEAL-'||lpad(g::text,4,'0'),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'bench-org-'||g,
         ('20000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,('40000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
         'bench-user-'||(5000+g),'ACTIVE','reviewer1' FROM generate_series(1,100) g;
INSERT INTO vehicles(vin,tenant_id,make,model,year,mileage,price,status,publication_status,current_seller_id)
  SELECT 'PROGRM'||lpad(g::text,11,'0'),('20000000-0000-4000-8000-'||lpad((1+g%100)::text,12,'0'))::uuid,
         'Synthetic','Programme',2020,1000,10000,'Available','draft','bench-user-'||(5001+g%100)
    FROM generate_series(1,400) g;
SET session_replication_role = origin;
VACUUM ANALYZE;
SELECT (SELECT count(*) FROM tenants) tenants,(SELECT count(*) FROM vehicles) vehicles,
       (SELECT count(*) FROM vehicles WHERE publication_status='published') published,
       (SELECT count(*) FROM dealer_approved_seed_links) links,(SELECT count(*) FROM tenant_users) memberships,
       (SELECT count(*) FROM dealer_profiles) profiles;
