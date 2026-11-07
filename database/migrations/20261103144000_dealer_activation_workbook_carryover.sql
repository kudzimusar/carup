-- +migrate Up
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, pg_temp;
DO $txnmark$
BEGIN
  -- R6 DBA review 4: the transaction marker is this transaction's own id, so a value preset at
  -- session, role or database level (or through PGOPTIONS) can never satisfy the guard below.
  PERFORM set_config('carup.dealer_migration_txn', txid_current()::text, true);
  -- …and the Down of this same version refuses to run later in this transaction (whole-file apply).
  PERFORM set_config('carup.dealer_migration_up_v20261103144000', txid_current()::text, true);
END
$txnmark$;
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2 / review 4: SET LOCAL is a silent no-op outside a transaction block, so a
  -- section applied statement by statement in autocommit (plain `psql -f`, an interactive paste)
  -- would lose its bounds and could apply half-way. When the marker set just above is not this
  -- transaction's own, the statements are not sharing one transaction: make the REST OF THIS
  -- SESSION read-only and return WITHOUT raising (a raise would roll the setting back; ending the
  -- session would let an interactive psql reconnect and run the remaining statements). Every later
  -- change in this session then fails with SQLSTATE 25006, so nothing can be applied half-way.
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM txid_current()::text THEN
    PERFORM set_config('default_transaction_read_only', 'on', false);
    PERFORM set_config('transaction_read_only', 'on', true);
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: this session is now read-only. Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section (Up OR Down).';
    RETURN;
  END IF;
END
$txnguard$;
-- CARUP-DEALER-ONB-001-LR01-R6 C02: the independently activated dealership must not
-- retype what its approved, frozen application already declared.
--
-- On the SAME transaction that inserts the dealer_approved_seed_links row (i.e. the
-- governed activation), every valid branch, its declared GPS pair and visitor hours,
-- and the dealer-level policy tabs are carried from the frozen submission snapshot
-- into the EXISTING canonical stores (dealer_branches; the versioned private
-- dealer_operational_declaration_events ledger). Nothing becomes verified, public,
-- priced or approved: branches stay private dealer declarations, declarations keep
-- publication_approved=false / independent_legal_verification=false, and public
-- display still requires the separate independent full-storefront review.
--
-- Every non-empty submitted field gets exactly one append-only provenance row naming
-- where it went (or why it did not go anywhere), keyed to the frozen submission. Values
-- are referenced by SHA-256, never copied: the frozen submission remains the only copy.

CREATE TABLE dealer_activation_branch_crosswalk (
 crosswalk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 link_id UUID NOT NULL REFERENCES dealer_approved_seed_links(link_id) ON DELETE RESTRICT,
 submission_id UUID NOT NULL REFERENCES dealer_claim_compliance_submissions(submission_id) ON DELETE RESTRICT,
 source_row INTEGER NOT NULL CHECK(source_row BETWEEN 1 AND 250),
 branch_ref TEXT NOT NULL CHECK(length(branch_ref) BETWEEN 1 AND 120),
 branch_id UUID NOT NULL UNIQUE REFERENCES dealer_branches(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(link_id,branch_ref),
 UNIQUE(link_id,source_row)
);
CREATE TABLE dealer_activation_carryover_events (
 event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 link_id UUID NOT NULL REFERENCES dealer_approved_seed_links(link_id) ON DELETE RESTRICT,
 submission_id UUID NOT NULL REFERENCES dealer_claim_compliance_submissions(submission_id) ON DELETE RESTRICT,
 dealer_profile_id UUID NOT NULL REFERENCES dealer_profiles(id) ON DELETE RESTRICT,
 source_tab TEXT NOT NULL CHECK(source_tab ~ '^[A-Z][A-Z_]{1,39}$'),
 source_row INTEGER NOT NULL CHECK(source_row BETWEEN 1 AND 250),
 source_field TEXT NOT NULL CHECK(source_field ~ '^[a-z][a-z0-9_]{0,79}$'),
 target TEXT NOT NULL CHECK(length(target) BETWEEN 3 AND 120),
 target_id UUID,
 disposition TEXT NOT NULL CHECK(disposition IN (
  'CARRIED_UNVERIFIED','REVIEWED_VALUE_PREFERRED','NOT_CARRIED_INVALID',
  'NOT_CARRIED_DUPLICATE','NOT_CARRIED_CONFLICT','RETAINED_PRIVATE_NOT_CANONICAL')),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 200),
 value_sha256 TEXT CHECK(value_sha256 IS NULL OR value_sha256 ~ '^[0-9a-f]{64}$'),
 research_value_differs BOOLEAN,
 independently_verified BOOLEAN NOT NULL DEFAULT false CHECK(independently_verified=false),
 publicly_approved BOOLEAN NOT NULL DEFAULT false CHECK(publicly_approved=false),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(link_id,source_tab,source_row,source_field)
);
CREATE INDEX dealer_activation_carryover_by_link
 ON dealer_activation_carryover_events(link_id,disposition);
ALTER TABLE dealer_activation_branch_crosswalk ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_activation_carryover_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_activation_branch_crosswalk FROM PUBLIC,anon,authenticated;
REVOKE ALL ON dealer_activation_carryover_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON dealer_activation_branch_crosswalk TO service_role;
GRANT SELECT ON dealer_activation_carryover_events TO service_role;
CREATE TRIGGER dealer_activation_branch_crosswalk_no_update
 BEFORE UPDATE ON dealer_activation_branch_crosswalk
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_activation_branch_crosswalk_no_delete
 BEFORE DELETE ON dealer_activation_branch_crosswalk
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_activation_carryover_no_update
 BEFORE UPDATE ON dealer_activation_carryover_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
CREATE TRIGGER dealer_activation_carryover_no_delete
 BEFORE DELETE ON dealer_activation_carryover_events
 FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();
COMMENT ON TABLE dealer_activation_carryover_events IS
 'Append-only field-level provenance from the frozen approved application to canonical dealer records. Values are referenced by SHA-256 only; nothing here is verified or public.';

-- Normalised submitted text, or NULL when empty. Workbook line breaks/tabs become spaces;
-- any other control character, markup, non-string JSON or over-long text is INVALID.
CREATE FUNCTION dealer_carryover_text(p JSONB, p_max INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE
  WHEN p IS NULL OR p='null'::jsonb THEN NULL
  WHEN jsonb_typeof(p) NOT IN ('string','number') THEN E'\x01INVALID'
  -- R6 DBA review 2 #8: refuse an over-long value by its byte size before any regex runs over it.
  WHEN octet_length(p#>>'{}') > 4*p_max+64 THEN E'\x01INVALID'
  WHEN btrim(regexp_replace(p#>>'{}',E'[\\r\\n\\t]+',' ','g'))='' THEN NULL
  WHEN length(btrim(regexp_replace(p#>>'{}',E'[\\r\\n\\t]+',' ','g')))>p_max
    OR regexp_replace(p#>>'{}',E'[\\r\\n\\t]+',' ','g') ~ '[[:cntrl:]]'
    OR (p#>>'{}') ~ '<[A-Za-z/!?]'
   THEN E'\x01INVALID'
  ELSE btrim(regexp_replace(p#>>'{}',E'[\\r\\n\\t]+',' ','g'))
 END
$$;
REVOKE ALL ON FUNCTION dealer_carryover_text(JSONB,INTEGER) FROM PUBLIC,anon,authenticated;

-- R6 DBA review 2 #8: the intake contract (backend TEMPLATE_FIELD_REGISTRY, README tab excluded):
-- 11 tabs, 111 fields. Only these tabs/fields are processed cell by cell; the harness pins this
-- list to the backend registry so the two cannot drift.
CREATE FUNCTION dealer_intake_contract_fields()
RETURNS TABLE(tab TEXT, field TEXT) LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT x.tab, x.field FROM (VALUES
  ('BUSINESS','claim_reference'),('BUSINESS','source_seed_id'),
  ('BUSINESS','research_display_name'),('BUSINESS','legal_name'),('BUSINESS','trading_name'),
  ('BUSINESS','operating_country'),('BUSINESS','registration_authority'),
  ('BUSINESS','registration_number'),('BUSINESS','registration_evidence_reference'),
  ('BUSINESS','tax_clearance_number'),('BUSINESS','tax_clearance_expiry'),
  ('BUSINESS','year_established'),('BUSINESS','business_model'),
  ('BUSINESS','responsible_signer_name'),('BUSINESS','business_email'),
  ('BUSINESS','business_phone'),('BUSINESS','head_office_address'),
  ('BUSINESS','research_confirmation'),('BRANCHES','branch_ref'),('BRANCHES','source_seed_id'),
  ('BRANCHES','branch_name'),('BRANCHES','branch_type'),('BRANCHES','physical_address'),
  ('BRANCHES','suburb'),('BRANCHES','city'),('BRANCHES','province'),('BRANCHES','country'),
  ('BRANCHES','gps_latitude'),('BRANCHES','gps_longitude'),('BRANCHES','maps_url'),
  ('BRANCHES','visiting_hours'),('BRANCHES','site_capacity'),
  ('BRANCHES','business_contact_phone'),('BRANCHES','source_confirmation'),
  ('LICENCES_AUTHORIZATIONS','authorization_ref'),('LICENCES_AUTHORIZATIONS','branch_ref'),
  ('LICENCES_AUTHORIZATIONS','authorization_type'),('LICENCES_AUTHORIZATIONS','issuer'),
  ('LICENCES_AUTHORIZATIONS','jurisdiction'),('LICENCES_AUTHORIZATIONS','scope'),
  ('LICENCES_AUTHORIZATIONS','reference_number'),('LICENCES_AUTHORIZATIONS','issued_at'),
  ('LICENCES_AUTHORIZATIONS','expires_at'),('LICENCES_AUTHORIZATIONS','evidence_ref'),
  ('LICENCES_AUTHORIZATIONS','conditional_applicability'),
  ('BRANDS_FRANCHISES','brand_claim_ref'),('BRANDS_FRANCHISES','branch_ref'),
  ('BRANDS_FRANCHISES','brand'),('BRANDS_FRANCHISES','relationship'),
  ('BRANDS_FRANCHISES','authorizing_issuer'),('BRANDS_FRANCHISES','effective_at'),
  ('BRANDS_FRANCHISES','expires_at'),('BRANDS_FRANCHISES','evidence_ref'),
  ('OPERATIONS_SOURCING','operation_ref'),('OPERATIONS_SOURCING','branch_ref'),
  ('OPERATIONS_SOURCING','sourcing_countries'),('OPERATIONS_SOURCING','sourcing_channels'),
  ('OPERATIONS_SOURCING','stock_model'),('OPERATIONS_SOURCING','vehicle_class'),
  ('OPERATIONS_SOURCING','import_duty_policy'),('OPERATIONS_SOURCING','lot_capacity'),
  ('OPERATIONS_SOURCING','capacity_period'),('OPERATIONS_SOURCING','sales_estimate'),
  ('FINANCE_PAYMENTS','policy_ref'),('FINANCE_PAYMENTS','branch_ref'),
  ('FINANCE_PAYMENTS','payment_methods'),('FINANCE_PAYMENTS','currencies'),
  ('FINANCE_PAYMENTS','finance_partner'),('FINANCE_PAYMENTS','written_terms'),
  ('FINANCE_PAYMENTS','fee_disclosures'),('FINANCE_PAYMENTS','refund_conditions'),
  ('FINANCE_PAYMENTS','evidence_ref'),('WORKSHOP_WARRANTY','policy_ref'),
  ('WORKSHOP_WARRANTY','branch_ref'),('WORKSHOP_WARRANTY','workshop_services'),
  ('WORKSHOP_WARRANTY','service_facility'),('WORKSHOP_WARRANTY','parts_support'),
  ('WORKSHOP_WARRANTY','warranty_coverage'),('WORKSHOP_WARRANTY','warranty_exclusions'),
  ('WORKSHOP_WARRANTY','warranty_term'),('WORKSHOP_WARRANTY','claims_process'),
  ('WORKSHOP_WARRANTY','partner_reference'),('BUYER_PROTECTION','buyer_policy_ref'),
  ('BUYER_PROTECTION','sale_contract_url'),('BUYER_PROTECTION','quote_includes_duty'),
  ('BUYER_PROTECTION','extra_fees_disclosed'),('BUYER_PROTECTION','deposit_policy'),
  ('BUYER_PROTECTION','independent_inspection'),('BUYER_PROTECTION','vin_before_deposit'),
  ('BUYER_PROTECTION','condition_report'),('BUYER_PROTECTION','transfer_process'),
  ('BUYER_PROTECTION','cancellation_policy'),('BUYER_PROTECTION','complaint_process'),
  ('BUYER_PROTECTION','policy_effective_at'),('DIGITAL_MEDIA','media_ref'),
  ('DIGITAL_MEDIA','branch_ref'),('DIGITAL_MEDIA','media_kind'),('DIGITAL_MEDIA','uri'),
  ('DIGITAL_MEDIA','alt_text'),('DIGITAL_MEDIA','rights_owner'),
  ('DIGITAL_MEDIA','license_reference'),('DIGITAL_MEDIA','public_visibility_request'),
  ('VEHICLE_INVENTORY_REFERENCE','branch_ref'),
  ('VEHICLE_INVENTORY_REFERENCE','inventory_batch_reference'),
  ('VEHICLE_INVENTORY_REFERENCE','mapping_notes'),('CONSENTS_DECLARATIONS','agreement_version'),
  ('CONSENTS_DECLARATIONS','agreement_hash'),('CONSENTS_DECLARATIONS','signer_name'),
  ('CONSENTS_DECLARATIONS','signer_role'),('CONSENTS_DECLARATIONS','declaration_draft'),
  ('CONSENTS_DECLARATIONS','privacy_acknowledgment')
  ) x(tab,field)
$$;
REVOKE ALL ON FUNCTION dealer_intake_contract_fields() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION dealer_carryover_note(
 p_link UUID,p_submission UUID,p_profile UUID,p_tab TEXT,p_row INTEGER,p_field TEXT,
 p_target TEXT,p_target_id UUID,p_disposition TEXT,p_reason TEXT,p_raw JSONB,
 p_research_differs BOOLEAN DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_field TEXT; v_tab TEXT;
BEGIN
 v_tab:=CASE WHEN p_tab ~ '^[A-Z][A-Z_]{1,39}$' THEN p_tab ELSE 'UNRECOGNISED_TAB' END;
 v_field:=CASE WHEN p_field ~ '^[a-z][a-z0-9_]{0,79}$' THEN p_field
   ELSE 'unrecognised_'||substr(md5(coalesce(p_field,'')),1,16) END;
 INSERT INTO dealer_activation_carryover_events(link_id,submission_id,dealer_profile_id,
  source_tab,source_row,source_field,target,target_id,disposition,reason,value_sha256,
  research_value_differs)
 VALUES(p_link,p_submission,p_profile,v_tab,least(greatest(p_row,1),250),v_field,p_target,
  p_target_id,p_disposition,p_reason,
  CASE WHEN p_raw IS NULL OR p_raw='null'::jsonb THEN NULL
   ELSE encode(sha256(convert_to(p_raw#>>'{}','UTF8')),'hex') END,
  p_research_differs)
 ON CONFLICT (link_id,source_tab,source_row,source_field) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION dealer_carryover_note(UUID,UUID,UUID,TEXT,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION dealer_carry_over_activation_workbook()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 s dealer_claim_compliance_submissions%ROWTYPE;
 law dealer_legal_application_reviews%ROWTYPE;
 v_seed JSONB; v_tabs JSONB; v_row JSONB; v_ord INTEGER; v_ref TEXT; v_refs TEXT[]:='{}';
 v_name TEXT; v_addr TEXT; v_part TEXT; v_lat TEXT; v_lng TEXT; v_hours TEXT;
 v_lat_n NUMERIC; v_lng_n NUMERIC; v_gps_ok BOOLEAN; v_branch UUID; v_first UUID;
 v_carried_branches INTEGER:=0; v_field TEXT; v_text TEXT;
 m RECORD; v_section TEXT; v_values JSONB; v_notes JSONB; v_event UUID; n JSONB;
 v_chosen INTEGER; v_chosen_text TEXT; v_sha TEXT; v_cell RECORD;
 v_tabname TEXT; v_tabval JSONB; v_extra INTEGER; v_written INTEGER:=0; v_capped BOOLEAN:=false;
BEGIN
 SELECT * INTO s FROM dealer_claim_compliance_submissions WHERE submission_id=NEW.submission_id;
 SELECT * INTO law FROM dealer_legal_application_reviews WHERE legal_review_id=NEW.legal_review_id;
 IF s.submission_id IS NULL OR jsonb_typeof(s.application_snapshot->'tab_rows')<>'object' THEN
  RETURN NEW;
 END IF;
 v_tabs:=s.application_snapshot->'tab_rows';
 SELECT source_snapshot INTO v_seed FROM dealer_research_seed_records
  WHERE seed_dealer_id=NEW.seed_dealer_id;

 -- 1. BUSINESS identity fields the activation itself already wrote (or deliberately
 --    replaced with the independently reviewed value).
 v_row:=v_tabs->'BUSINESS'->0;
 IF jsonb_typeof(v_row)='object' THEN
  PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BUSINESS',1,
   'legal_name','dealer_profiles.legal_name',NEW.dealer_profile_id,'CARRIED_UNVERIFIED',
   'Declared legal name carried by the governed activation; identity was reviewed separately',
   v_row->'legal_name') WHERE dealer_carryover_text(v_row->'legal_name',180) IS NOT NULL;
  PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BUSINESS',1,
   'trading_name','dealer_profiles.trading_name',NEW.dealer_profile_id,'CARRIED_UNVERIFIED',
   'Declared trading name carried; not a verified brand or licence',v_row->'trading_name',
   CASE WHEN v_seed ? 'Dealer / Company Name' THEN
     lower(btrim(v_row->>'trading_name')) IS DISTINCT FROM lower(btrim(v_seed->>'Dealer / Company Name')) END)
   WHERE dealer_carryover_text(v_row->'trading_name',180) IS NOT NULL;
  PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BUSINESS',1,
   'registration_number','dealer_profiles.registration_number',NEW.dealer_profile_id,
   CASE WHEN upper(btrim(v_row->>'registration_number'))=upper(btrim(law.reviewed_registration_number))
    THEN 'CARRIED_UNVERIFIED' ELSE 'REVIEWED_VALUE_PREFERRED' END,
   CASE WHEN upper(btrim(v_row->>'registration_number'))=upper(btrim(law.reviewed_registration_number))
    THEN 'Declared number equals the independently reviewed registration number'
    ELSE 'Conflict: the independently reviewed registration number is canonical, the declared value is kept only in the frozen submission' END,
   v_row->'registration_number')
   WHERE dealer_carryover_text(v_row->'registration_number',180) IS NOT NULL;
  PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BUSINESS',1,
   'operating_country','dealer_profiles.operating_country',NEW.dealer_profile_id,
   CASE WHEN upper(btrim(v_row->>'operating_country'))=law.country_code
    THEN 'CARRIED_UNVERIFIED' ELSE 'REVIEWED_VALUE_PREFERRED' END,
   'Country is taken from the independent legal review',v_row->'operating_country')
   WHERE dealer_carryover_text(v_row->'operating_country',8) IS NOT NULL;
 END IF;

 -- 2. Every valid branch → canonical dealer_branches (private, unverified).
 --    Row 1 is the branch the activation inserted; it is enriched, not duplicated.
 SELECT b.id INTO v_first FROM dealer_branches b
  WHERE b.dealer_id=NEW.dealer_profile_id
    AND NOT EXISTS(SELECT 1 FROM dealer_activation_branch_crosswalk x WHERE x.branch_id=b.id)
  ORDER BY b.created_at DESC, b.id LIMIT 1;
 IF jsonb_typeof(v_tabs->'BRANCHES')='array' THEN
  FOR v_row,v_ord IN
   SELECT r.value,r.ord::int FROM jsonb_array_elements(v_tabs->'BRANCHES') WITH ORDINALITY r(value,ord)
   WHERE r.ord<=250 ORDER BY r.ord
  LOOP
   CONTINUE WHEN jsonb_typeof(v_row)<>'object';
   v_ref:=coalesce(dealer_carryover_text(v_row->'branch_ref',120),'ROW-'||v_ord);
   v_name:=dealer_carryover_text(v_row->'branch_name',200);
   IF v_ref=E'\x01INVALID' THEN v_ref:='ROW-'||v_ord; END IF;
   IF v_ref=ANY(v_refs) THEN
    PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BRANCHES',v_ord,
     'branch_name','dealer_branches',NULL,'NOT_CARRIED_DUPLICATE',
     'Duplicate branch reference in the submission; the first row was carried',v_row->'branch_name');
    CONTINUE;
   END IF;
   IF NOT (v_ord=1 AND v_first IS NOT NULL) AND
      (v_name IS NULL OR v_name=E'\x01INVALID' OR v_carried_branches>=50) THEN
    PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BRANCHES',v_ord,
     'branch_name','dealer_branches',NULL,'NOT_CARRIED_INVALID',
     CASE WHEN v_carried_branches>=50 THEN 'Branch limit of 50 reached'
      ELSE 'A branch needs a safe, non-empty name' END,v_row->'branch_name');
    CONTINUE;
   END IF;
   v_refs:=v_refs||v_ref;
   -- Address: physical address, suburb, city, province — each part validated.
   v_addr:=NULL;
   FOREACH v_field IN ARRAY ARRAY['physical_address','suburb','city','province'] LOOP
    v_part:=dealer_carryover_text(v_row->v_field,200);
    IF v_part=E'\x01INVALID' THEN
     PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BRANCHES',v_ord,
      v_field,'dealer_branches.address',NULL,'NOT_CARRIED_INVALID',
      'Unsafe or over-long address part was not carried',v_row->v_field);
    ELSIF v_part IS NOT NULL THEN
     v_addr:=CASE WHEN v_addr IS NULL THEN v_part ELSE v_addr||', '||v_part END;
    END IF;
   END LOOP;
   v_addr:=left(v_addr,500);
   -- GPS: both or neither, numeric, in range.
   v_lat:=dealer_carryover_text(v_row->'gps_latitude',20);
   v_lng:=dealer_carryover_text(v_row->'gps_longitude',20);
   v_gps_ok:=false; v_lat_n:=NULL; v_lng_n:=NULL;
   IF v_lat ~ '^-?[0-9]{1,3}(\.[0-9]{1,8})?$' AND v_lng ~ '^-?[0-9]{1,3}(\.[0-9]{1,8})?$' THEN
    v_lat_n:=round(v_lat::numeric,6); v_lng_n:=round(v_lng::numeric,6);
    v_gps_ok:=v_lat_n BETWEEN -90 AND 90 AND v_lng_n BETWEEN -180 AND 180;
   END IF;
   IF NOT v_gps_ok THEN v_lat_n:=NULL; v_lng_n:=NULL; END IF;
   v_hours:=dealer_carryover_text(v_row->'visiting_hours',350);
   IF v_hours=E'\x01INVALID' THEN v_hours:=NULL; END IF;
   IF v_ord=1 AND v_first IS NOT NULL THEN
    UPDATE dealer_branches SET
      address=coalesce(v_addr,address),
      latitude=v_lat_n,longitude=v_lng_n,opening_hours_text=v_hours,
      operating_details_updated_at=CASE WHEN v_gps_ok OR v_hours IS NOT NULL THEN now()
        ELSE operating_details_updated_at END
     WHERE id=v_first RETURNING id INTO v_branch;
   ELSE
    INSERT INTO dealer_branches(dealer_id,name,address,latitude,longitude,opening_hours_text,
      operating_details_updated_at)
    VALUES(NEW.dealer_profile_id,v_name,v_addr,v_lat_n,v_lng_n,v_hours,
      CASE WHEN v_gps_ok OR v_hours IS NOT NULL THEN now() END)
    RETURNING id INTO v_branch;
   END IF;
   INSERT INTO dealer_activation_branch_crosswalk(link_id,submission_id,source_row,branch_ref,branch_id)
    VALUES(NEW.link_id,s.submission_id,v_ord,v_ref,v_branch);
   v_carried_branches:=v_carried_branches+1;
   PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BRANCHES',v_ord,
    'branch_name','dealer_branches.name',v_branch,'CARRIED_UNVERIFIED',
    'Declared branch carried as a private canonical branch',v_row->'branch_name');
   FOREACH v_field IN ARRAY ARRAY['physical_address','suburb','city','province'] LOOP
    PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BRANCHES',v_ord,
     v_field,'dealer_branches.address',v_branch,'CARRIED_UNVERIFIED',
     'Declared location carried; not an independently verified site',v_row->v_field,
     CASE WHEN v_ord=1 AND v_field='physical_address' AND v_seed ? 'Physical Address' THEN
       lower(btrim(v_row->>v_field)) IS DISTINCT FROM lower(btrim(v_seed->>'Physical Address'))
      WHEN v_ord=1 AND v_field='suburb' AND v_seed ? 'Suburb / Area' THEN
       lower(btrim(v_row->>v_field)) IS DISTINCT FROM lower(btrim(v_seed->>'Suburb / Area'))
      WHEN v_ord=1 AND v_field='city' AND v_seed ? 'City / Town' THEN
       lower(btrim(v_row->>v_field)) IS DISTINCT FROM lower(btrim(v_seed->>'City / Town')) END)
     WHERE dealer_carryover_text(v_row->v_field,200) IS NOT NULL;
   END LOOP;
   FOREACH v_field IN ARRAY ARRAY['gps_latitude','gps_longitude'] LOOP
    PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BRANCHES',v_ord,
     v_field,CASE v_field WHEN 'gps_latitude' THEN 'dealer_branches.latitude' ELSE 'dealer_branches.longitude' END,
     v_branch,CASE WHEN v_gps_ok THEN 'CARRIED_UNVERIFIED' ELSE 'NOT_CARRIED_INVALID' END,
     CASE WHEN v_gps_ok THEN 'Declared coordinate carried privately; never a verified public location'
      ELSE 'GPS needs both a latitude (-90..90) and a longitude (-180..180)' END,v_row->v_field)
     WHERE dealer_carryover_text(v_row->v_field,20) IS NOT NULL;
   END LOOP;
   PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,'BRANCHES',v_ord,
    'visiting_hours','dealer_branches.opening_hours_text',v_branch,
    CASE WHEN v_hours IS NOT NULL THEN 'CARRIED_UNVERIFIED' ELSE 'NOT_CARRIED_INVALID' END,
    CASE WHEN v_hours IS NOT NULL THEN 'Declared schedule carried; never an open-now assertion'
     ELSE 'Unsafe or over-long opening hours were not carried' END,v_row->'visiting_hours')
    WHERE dealer_carryover_text(v_row->'visiting_hours',350) IS NOT NULL;
  END LOOP;
 END IF;

 -- 3. Dealer-level policy tabs → version 1 of the existing private declaration sections.
 --    A section is dealer-wide: the business-level row (blank branch_ref) wins, then the
 --    first row; differing values on other rows are recorded as conflicts, not merged.
 FOR v_section IN SELECT DISTINCT section FROM (VALUES
   ('BUSINESS_OVERVIEW'),('BUYER_ASSURANCE'),('FINANCE_TERMS'),('SOURCING'),
   ('WARRANTY_AFTERSALES'),('SERVICE_CAPABILITIES')) x(section)
 LOOP
  v_values:='{}'::jsonb; v_notes:='[]'::jsonb;
  FOR m IN SELECT * FROM (VALUES
    ('BUSINESS_OVERVIEW','public_description','BUSINESS','business_model'),
    ('BUSINESS_OVERVIEW','declared_contact_email','BUSINESS','business_email'),
    ('BUYER_ASSURANCE','inspection_rights','BUYER_PROTECTION','independent_inspection'),
    ('BUYER_ASSURANCE','cancellation_policy','BUYER_PROTECTION','cancellation_policy'),
    ('BUYER_ASSURANCE','refund_policy','FINANCE_PAYMENTS','refund_conditions'),
    ('BUYER_ASSURANCE','dispute_resolution','BUYER_PROTECTION','complaint_process'),
    ('FINANCE_TERMS','deposit_terms','BUYER_PROTECTION','deposit_policy'),
    ('FINANCE_TERMS','accepted_payment_methods','FINANCE_PAYMENTS','payment_methods'),
    ('FINANCE_TERMS','finance_partner_disclosure','FINANCE_PAYMENTS','finance_partner'),
    ('FINANCE_TERMS','currency_disclosure','FINANCE_PAYMENTS','currencies'),
    ('SOURCING','sourcing_channels','OPERATIONS_SOURCING','sourcing_channels'),
    ('SOURCING','import_duty_disclosure','OPERATIONS_SOURCING','import_duty_policy'),
    ('WARRANTY_AFTERSALES','warranty_scope','WORKSHOP_WARRANTY','warranty_coverage'),
    ('WARRANTY_AFTERSALES','warranty_exclusions','WORKSHOP_WARRANTY','warranty_exclusions'),
    ('WARRANTY_AFTERSALES','repair_support','WORKSHOP_WARRANTY','service_facility'),
    ('WARRANTY_AFTERSALES','spare_parts_support','WORKSHOP_WARRANTY','parts_support'),
    ('SERVICE_CAPABILITIES','workshop_services','WORKSHOP_WARRANTY','workshop_services'))
    x(section,decl_key,tab,field) WHERE x.section=v_section
  LOOP
   CONTINUE WHEN jsonb_typeof(v_tabs->m.tab)<>'array';
   v_chosen:=NULL; v_chosen_text:=NULL;
   FOR v_cell IN
    SELECT r.ord::int AS ord,r.value->m.field AS raw,
      dealer_carryover_text(r.value->m.field,750) AS txt
    FROM jsonb_array_elements(v_tabs->m.tab) WITH ORDINALITY r(value,ord)
    WHERE r.ord<=250 AND jsonb_typeof(r.value)='object'
    ORDER BY (nullif(btrim(coalesce(r.value->>'branch_ref','')),'') IS NOT NULL), r.ord
   LOOP
    CONTINUE WHEN v_cell.txt IS NULL;
    IF v_cell.txt=E'\x01INVALID' THEN
     v_notes:=v_notes||jsonb_build_object('tab',m.tab,'row',v_cell.ord,'field',m.field,
      'disposition','NOT_CARRIED_INVALID','reason','Unsafe, non-text or over-long (750) value was not carried',
      'raw',v_cell.raw);
    ELSIF v_chosen IS NULL THEN
     v_chosen:=v_cell.ord; v_chosen_text:=v_cell.txt;
     v_values:=v_values||jsonb_build_object(m.decl_key,v_cell.txt);
     v_notes:=v_notes||jsonb_build_object('tab',m.tab,'row',v_cell.ord,'field',m.field,
      'disposition','CARRIED_UNVERIFIED','target','declaration:'||v_section||'.'||m.decl_key,
      'reason','Carried as a private, unverified dealer declaration (version 1)','raw',v_cell.raw);
    ELSIF v_cell.txt=v_chosen_text THEN
     v_notes:=v_notes||jsonb_build_object('tab',m.tab,'row',v_cell.ord,'field',m.field,
      'disposition','NOT_CARRIED_DUPLICATE','reason','Same value as row '||v_chosen||', which was carried',
      'raw',v_cell.raw);
    ELSE
     v_notes:=v_notes||jsonb_build_object('tab',m.tab,'row',v_cell.ord,'field',m.field,
      'disposition','NOT_CARRIED_CONFLICT',
      'reason','Section is dealer-wide; row '||v_chosen||' was carried and this differing value was not merged',
      'raw',v_cell.raw);
    END IF;
   END LOOP;
  END LOOP;
  v_event:=NULL;
  IF v_values<>'{}'::jsonb AND NOT EXISTS(SELECT 1 FROM dealer_operational_declaration_events
     WHERE dealer_profile_id=NEW.dealer_profile_id AND section=v_section) THEN
   v_sha:=encode(sha256(convert_to(v_values::text,'UTF8')),'hex');
   INSERT INTO dealer_operational_declaration_events(dealer_profile_id,tenant_id,actor_user_id,
     section,section_version,declared_values,content_sha256)
   VALUES(NEW.dealer_profile_id,NEW.tenant_id,NEW.claimant_user_id,v_section,1,v_values,v_sha)
   RETURNING event_id INTO v_event;
  END IF;
  FOR n IN SELECT value FROM jsonb_array_elements(v_notes) LOOP
   PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,n->>'tab',
    (n->>'row')::int,n->>'field',coalesce(n->>'target','declaration:'||v_section),
    CASE WHEN n->>'disposition'='CARRIED_UNVERIFIED' THEN v_event END,
    CASE WHEN n->>'disposition'='CARRIED_UNVERIFIED' AND v_event IS NULL THEN 'NOT_CARRIED_CONFLICT'
     ELSE n->>'disposition' END,
    CASE WHEN n->>'disposition'='CARRIED_UNVERIFIED' AND v_event IS NULL
     THEN 'A declaration for this section already existed and was not overwritten'
     ELSE n->>'reason' END,
    n->'raw');
  END LOOP;
 END LOOP;

 -- 4. Everything else that was declared stays private in the frozen submission and is
 --    listed, so nothing is silently dropped. Pure reference keys are structural.
 --    R6 DBA review 2 #8: bounded by the intake contract — only contract tabs and fields are
 --    noted cell by cell (at most 11 tabs x 250 rows, 111 fields: under 23,300 cells, so a
 --    legitimate activation never reaches the 25,000-row cap below). A tab that is not a row
 --    list, rows beyond 250, a non-object row and non-contract fields each get ONE note, never
 --    one per hostile cell.
 --    R6 DBA review 3 (#8 leftover): non-contract TABS are bounded too — the first 25 (in key
 --    order) get one note each, every further one is counted in ONE summary note (50,000 hostile
 --    tabs once meant 50,002 rows / 8.9 s) — and every section-4 note counts toward the cap.
 FOR v_tabname IN SELECT t.key FROM jsonb_object_keys(v_tabs) t(key)
   WHERE t.key NOT LIKE 'README%'
     AND NOT EXISTS(SELECT 1 FROM dealer_intake_contract_fields() c WHERE c.tab=t.key)
   ORDER BY t.key LIMIT 25
 LOOP
  PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,
   'UNRECOGNISED_TAB_'||translate(upper(substr(md5(v_tabname),1,10)),'0123456789','GHIJKLMNOP'),
   1,'tab_not_in_contract','frozen_submission',NULL,'NOT_CARRIED_INVALID',
   'Tab is not part of the intake contract; it stays only in the frozen submission',to_jsonb(v_tabname));
  v_written:=v_written+1;
 END LOOP;
 SELECT count(*)::int INTO v_extra FROM jsonb_object_keys(v_tabs) t(key)
  WHERE t.key NOT LIKE 'README%'
    AND NOT EXISTS(SELECT 1 FROM dealer_intake_contract_fields() c WHERE c.tab=t.key);
 IF v_extra>25 THEN
  PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,
   'UNRECOGNISED_TABS',1,'tabs_not_listed','frozen_submission',NULL,'NOT_CARRIED_INVALID',
   (v_extra-25)||' further tab(s) outside the intake contract stay only in the frozen submission (not listed)',NULL);
  v_written:=v_written+1;
 END IF;
 <<tabs>>
 FOR v_tabname IN SELECT t.key FROM jsonb_object_keys(v_tabs) t(key)
   WHERE EXISTS(SELECT 1 FROM dealer_intake_contract_fields() c WHERE c.tab=t.key)
   ORDER BY t.key
 LOOP
  v_tabval:=v_tabs->v_tabname;
  IF jsonb_typeof(v_tabval)<>'array' THEN
   PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,v_tabname,1,
    'tab_not_a_row_list','frozen_submission',NULL,'NOT_CARRIED_INVALID',
    'Tab is not a list of rows; nothing in it was carried',NULL);
   v_written:=v_written+1;
   CONTINUE;
  END IF;
  IF jsonb_array_length(v_tabval)>250 THEN
   PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,v_tabname,250,
    'rows_beyond_limit','frozen_submission',NULL,'NOT_CARRIED_INVALID',
    (jsonb_array_length(v_tabval)-250)||' row(s) beyond the 250-row contract limit were not processed',NULL);
   v_written:=v_written+1;
  END IF;
  FOR v_cell IN SELECT r.ord::int AS ord,r.value AS raw
   FROM jsonb_array_elements(v_tabval) WITH ORDINALITY r(value,ord)
   WHERE r.ord<=250 AND jsonb_typeof(r.value)<>'object' ORDER BY r.ord
  LOOP
   IF v_written>=25000 THEN v_capped:=true; EXIT tabs; END IF;
   PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,v_tabname,v_cell.ord,
    'row_not_an_object','frozen_submission',NULL,'NOT_CARRIED_INVALID',
    'Row is not a field object; nothing in it was carried',v_cell.raw);
   v_written:=v_written+1;
  END LOOP;
  SELECT count(*)::int INTO v_extra
   FROM jsonb_array_elements(v_tabval) WITH ORDINALITY r(value,ord)
   CROSS JOIN LATERAL jsonb_object_keys(r.value) k
   WHERE r.ord<=250 AND jsonb_typeof(r.value)='object'
     AND NOT EXISTS(SELECT 1 FROM dealer_intake_contract_fields() c WHERE c.tab=v_tabname AND c.field=k);
  IF v_extra>0 THEN
   PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,v_tabname,1,
    'non_contract_fields','frozen_submission',NULL,'NOT_CARRIED_INVALID',
    v_extra||' value(s) under keys outside the intake contract stay only in the frozen submission',NULL);
   v_written:=v_written+1;
  END IF;
  FOR v_cell IN
   SELECT r.ord::int AS ord,c.key AS field,c.value AS raw
   FROM jsonb_array_elements(v_tabval) WITH ORDINALITY r(value,ord)
   CROSS JOIN LATERAL jsonb_each(r.value) c
   WHERE r.ord<=250 AND jsonb_typeof(r.value)='object'
     AND EXISTS(SELECT 1 FROM dealer_intake_contract_fields() f WHERE f.tab=v_tabname AND f.field=c.key)
     AND c.key NOT IN ('claim_reference','source_seed_id','research_display_name',
      'branch_ref','brand_claim_ref','authorization_ref','operation_ref','policy_ref',
      'buyer_policy_ref','media_ref')
   ORDER BY r.ord,c.key
  LOOP
   v_text:=dealer_carryover_text(v_cell.raw,750);
   CONTINUE WHEN v_text IS NULL;
   IF v_written>=25000 THEN v_capped:=true; EXIT tabs; END IF;
   PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,v_tabname,
    v_cell.ord,v_cell.field,'frozen_submission',NULL,
    CASE WHEN v_text=E'\x01INVALID' THEN 'NOT_CARRIED_INVALID' ELSE 'RETAINED_PRIVATE_NOT_CANONICAL' END,
    CASE WHEN v_text=E'\x01INVALID' THEN 'Unsafe, non-text or over-long value'
     ELSE 'No canonical owner for this field; it stays private in the frozen application' END,
    v_cell.raw);
   v_written:=v_written+1;
  END LOOP;
 END LOOP;
 IF v_capped THEN
  PERFORM dealer_carryover_note(NEW.link_id,s.submission_id,NEW.dealer_profile_id,v_tabname,250,
   'provenance_cap_reached','frozen_submission',NULL,'NOT_CARRIED_INVALID',
   'Provenance cap of 25,000 retained-field notes reached; the rest stays only in the frozen submission',NULL);
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION dealer_carry_over_activation_workbook() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER dealer_activation_workbook_carryover
 AFTER INSERT ON dealer_approved_seed_links
 FOR EACH ROW EXECUTE FUNCTION dealer_carry_over_activation_workbook();

-- Read model for the activated owner (service layer enforces the owner workspace).
CREATE FUNCTION dealer_read_activation_carryover(p_profile_id UUID,p_tenant_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'submission_id',l.submission_id,
  'application_version',s.intake_version,
  'legal_review_id',l.legal_review_id,
  'activated_at',l.activated_at,
  'branches',coalesce((SELECT jsonb_agg(jsonb_build_object('branch_ref',x.branch_ref,
     'source_row',x.source_row,'branch_id',x.branch_id,'name',b.name,
     'has_gps',b.latitude IS NOT NULL,'has_hours',b.opening_hours_text IS NOT NULL)
     ORDER BY x.source_row)
    FROM dealer_activation_branch_crosswalk x JOIN dealer_branches b ON b.id=x.branch_id
    WHERE x.link_id=l.link_id),'[]'::jsonb),
  'sections',coalesce((SELECT jsonb_agg(DISTINCT split_part(substr(e.target,13),'.',1))
    FROM dealer_activation_carryover_events e WHERE e.link_id=l.link_id
     AND e.disposition='CARRIED_UNVERIFIED' AND e.target LIKE 'declaration:%'),'[]'::jsonb),
  'counts',(SELECT coalesce(jsonb_object_agg(d.disposition,d.n),'{}'::jsonb) FROM
    (SELECT disposition,count(*)::int AS n FROM dealer_activation_carryover_events
     WHERE link_id=l.link_id GROUP BY disposition) d),
  'needs_attention',coalesce((SELECT jsonb_agg(jsonb_build_object('tab',e.source_tab,
     'row',e.source_row,'field',e.source_field,'disposition',e.disposition,'reason',e.reason)
     ORDER BY e.source_tab,e.source_row,e.source_field)
    FROM dealer_activation_carryover_events e WHERE e.link_id=l.link_id
     AND e.disposition IN ('NOT_CARRIED_INVALID','NOT_CARRIED_CONFLICT')),'[]'::jsonb),
  'independently_verified',false,'publicly_approved',false)
 FROM dealer_approved_seed_links l
 JOIN dealer_claim_compliance_submissions s ON s.submission_id=l.submission_id
 WHERE l.dealer_profile_id=p_profile_id AND l.tenant_id=p_tenant_id
$$;
REVOKE ALL ON FUNCTION dealer_read_activation_carryover(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dealer_read_activation_carryover(UUID,UUID) TO service_role;

-- +migrate Down
-- R6 DBA review 2 #1: a Down takes ACCESS EXCLUSIVE on canonical tables (FKs, triggers, policies);
-- never queue readers behind it indefinitely. Fails with 55P03 after 3 s; re-run the rollback.
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, pg_temp;
DO $txnmark$
BEGIN
  -- R6 DBA review 4: the transaction marker is this transaction's own id, so a value preset at
  -- session, role or database level (or through PGOPTIONS) can never satisfy the guard below.
  PERFORM set_config('carup.dealer_migration_txn', txid_current()::text, true);
END
$txnmark$;
DO $txnguard$
BEGIN
  -- R6 DBA review 3 N2 / review 4: SET LOCAL is a silent no-op outside a transaction block, so a
  -- section applied statement by statement in autocommit (plain `psql -f`, an interactive paste)
  -- would lose its bounds and could apply half-way. When the marker set just above is not this
  -- transaction's own, the statements are not sharing one transaction: make the REST OF THIS
  -- SESSION read-only and return WITHOUT raising (a raise would roll the setting back; ending the
  -- session would let an interactive psql reconnect and run the remaining statements). Every later
  -- change in this session then fails with SQLSTATE 25006, so nothing can be applied half-way.
  IF current_setting('carup.dealer_migration_txn', true) IS DISTINCT FROM txid_current()::text THEN
    PERFORM set_config('default_transaction_read_only', 'on', false);
    PERFORM set_config('transaction_read_only', 'on', true);
    RAISE WARNING 'DEALER_MIGRATION_MUST_RUN_IN_ONE_TRANSACTION: this session is now read-only. Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section (Up OR Down).';
    RETURN;
  END IF;
  -- R6 DBA review 4 R1: this version's Up ran earlier in THIS transaction — a whole file (Up then
  -- Down) was applied as one transaction, which would silently undo itself. Refuse loudly; the
  -- whole transaction rolls back.
  IF current_setting('carup.dealer_migration_up_v20261103144000', true) = txid_current()::text THEN
    RAISE EXCEPTION 'DEALER_MIGRATION_WHOLE_FILE_APPLY_REFUSED: the Up and the Down of 20261103144000 ran in one transaction'
      USING HINT = 'Apply ONLY through backend/scripts/dealership/applyDealerMigrations.mjs, or psql -1 -v ON_ERROR_STOP=1 on a file containing a single section.';
  END IF;
END
$txnguard$;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM dealer_activation_carryover_events)
   OR EXISTS(SELECT 1 FROM dealer_activation_branch_crosswalk) THEN
  RAISE EXCEPTION 'CANNOT_ROLLBACK_WITH_ACTIVATION_CARRYOVER_CUSTODY';
 END IF;
END;
$$;
DROP TRIGGER IF EXISTS dealer_activation_workbook_carryover ON dealer_approved_seed_links;
DROP FUNCTION IF EXISTS dealer_read_activation_carryover(UUID,UUID);
DROP FUNCTION IF EXISTS dealer_carry_over_activation_workbook();
DROP FUNCTION IF EXISTS dealer_carryover_note(UUID,UUID,UUID,TEXT,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,JSONB,BOOLEAN);
DROP FUNCTION IF EXISTS dealer_carryover_text(JSONB,INTEGER);
DROP FUNCTION IF EXISTS dealer_intake_contract_fields();
DROP TABLE IF EXISTS dealer_activation_carryover_events;
DROP TABLE IF EXISTS dealer_activation_branch_crosswalk;
