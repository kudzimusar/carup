-- +migrate Up
-- =============================================================================
-- ISSUE #101 — PHASE P2: STAGING PARITY for the twelve absent relations
-- =============================================================================
--
-- WHY THIS EXISTS. The merged #155 P0 hardening targets fourteen tables. Governed
-- staging holds only three of them, so #155 cannot be certified there. Eleven must be
-- created — and one of their foreign keys points at a twelfth relation, public_keys,
-- which is also absent. Dropping that FK to avoid creating public_keys was rejected:
-- staging must preserve the production constraint.
--
-- STRUCTURAL TRUTH IS THE PRODUCTION MEASUREMENT, NOT HISTORY.
--   run 31770747669  the eleven: 100 columns, 25 PK/UNIQUE/CHECK, 10 FKs,
--                    25 index-inventory rows (17 constraint-created, 8 independent),
--                    3 owned bigint sequences, 0 policies, 0 triggers, 0 custom types.
--   run 31774496416  public_keys: 8 columns, PK + CHECK + FK, 1 independent index,
--                    0 sequences, 0 policies, 0 triggers, 0 custom types.
-- Both receipts are committed under database/parity/receipts/ and every statement below
-- was generated from them, so the DDL cannot drift from the evidence by hand-editing.
--
-- HISTORY IS PROVENANCE ONLY, AND IT DISAGREES. scripts/deploy-hardening-schema.js,
-- 004_add_tamper_proofing.sql and 005_persist_private_keys.sql all create public_keys,
-- and only the deploy script matches production: 005 appends private_key_pem LAST,
-- production has it at ordinal 4; 004 creates no index, production has
-- idx_public_keys_user; 004's incoming FK omits ON DELETE, production's is CASCADE.
-- Where source and measurement disagree, the measurement wins.
--
-- ATOMICITY. The migration runner wraps each file in BEGIN/COMMIT (backend/db/migrate.js)
-- and every statement here is transactional DDL, so the twelve tables, their indexes,
-- their sequences and their RLS/ACL posture all land together or not at all. This file
-- deliberately opens no transaction of its own, and contains no statement that would
-- force an implicit commit or refuse to run inside a transaction block. A test asserts
-- that, because any one of them would silently break the all-or-nothing guarantee.
--
-- NO "IF NOT EXISTS" ON ANY CREATE. Accepting a pre-existing object would be accepting
-- unknown drift. Every target must be absent, or this migration refuses to run.
--
-- SECURITY POSTURE IS DELIBERATELY NOT PRODUCTION ACL PARITY. Production grants anon and
-- authenticated all eight privileges on these tables — including TRUNCATE, which RLS
-- never governs — and public_keys holds cryptographic key material. Reproducing that on
-- staging for byte-level fidelity would be reproducing the defect. Structural parity and
-- security posture are separate dimensions, and only the first is copied.
--
-- NO DATA. No row is inserted, seeded, copied or migrated. No production key material
-- is read or reproduced. This file creates empty structures only.
--
-- private_key_pem is reconstructed because current application code expects the
-- production schema. Removing plaintext private-key persistence is Issue #158 and is
-- deliberately NOT solved here.

-- ─────────────────────────────────────────────────────────────────────────────
-- PRECONDITION 0 — service_role MUST exist and MUST bypass RLS.  FAIL-LOUD.
-- ─────────────────────────────────────────────────────────────────────────────
-- Every table created below gets RLS enabled with no anon/authenticated policy. That
-- is non-breaking for the backend ONLY because it reaches Postgres through the
-- service-role client, which bypasses RLS. Without that, this migration would create
-- twelve tables the application cannot read or write.
DO $parity_service_role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION
      '[issue-101-p2] service_role is absent or lacks BYPASSRLS. Creating twelve RLS-enabled tables with no policy would leave them unreadable by the backend. Refusing to create anything.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$parity_service_role$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRECONDITION 1 — all twelve parity objects MUST be ABSENT.  FAIL-LOUD.
-- ─────────────────────────────────────────────────────────────────────────────
-- This is also the accidental-production guard, and it is the reason the guard is
-- reliable rather than advisory: production already contains all twelve, so running
-- this file against production raises before the first CREATE. There is no mode, flag
-- or environment variable to override it.
DO $parity_absent$
DECLARE
  v_present text[];
BEGIN
  SELECT array_agg(name ORDER BY name) INTO v_present
    FROM unnest(ARRAY[
      'public_keys',
      'cid_clearance_records',
      'cvr_ownership_records',
      'ocr_customs_declarations',
      'ocr_national_ids',
      'ocr_registration_books',
      'performance_telemetry',
      'signature_verification_logs',
      'system_failures',
      'vid_inspections',
      'zimra_declarations',
      'zinara_licensing_records'
    ]) AS name
   WHERE to_regclass('public.' || name) IS NOT NULL;

  IF v_present IS NOT NULL THEN
    RAISE EXCEPTION
      '[issue-101-p2] refusing to run: relation(s) already present: %. This migration creates twelve relations from scratch and never adopts an existing object of unknown shape. All twelve exist in PRODUCTION, so this is also what stops an accidental production apply.',
      array_to_string(v_present, ', ')
      USING ERRCODE = 'duplicate_table';
  END IF;
END
$parity_absent$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRECONDITION 2 — every FK referent MUST exist with a compatible key.  FAIL-LOUD.
-- ─────────────────────────────────────────────────────────────────────────────
-- The eleven reference users(id), vehicles(vin) and ocr_documents(id); public_keys
-- references users(id). All four referencing columns are text in production, and a
-- foreign key additionally requires the referenced column to carry a unique or primary
-- key constraint. Both are checked, so a missing or mistyped referent fails here with
-- the column named rather than deep inside CREATE TABLE.
DO $parity_referents$
DECLARE
  r          record;
  v_type     text;
  v_unique   boolean;
  v_problems text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('users',         'id'),
      ('vehicles',      'vin'),
      ('ocr_documents', 'id')
    ) AS t(tbl, col)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      v_problems := v_problems || format('%I is absent', r.tbl);
      CONTINUE;
    END IF;

    SELECT c.udt_name INTO v_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = r.tbl AND c.column_name = r.col;

    IF v_type IS NULL THEN
      v_problems := v_problems || format('%I.%I is absent', r.tbl, r.col);
      CONTINUE;
    ELSIF v_type <> 'text' THEN
      v_problems := v_problems || format('%I.%I is %s, expected text', r.tbl, r.col, v_type);
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM pg_constraint pc
        JOIN pg_class pcl ON pcl.oid = pc.conrelid
        JOIN pg_namespace pn ON pn.oid = pcl.relnamespace
        JOIN pg_attribute pa ON pa.attrelid = pcl.oid AND pa.attnum = ANY (pc.conkey)
       WHERE pn.nspname = 'public' AND pcl.relname = r.tbl
         AND pc.contype IN ('p', 'u') AND array_length(pc.conkey, 1) = 1
         AND pa.attname = r.col
    ) INTO v_unique;

    IF NOT v_unique THEN
      v_problems := v_problems
        || format('%I.%I has no single-column PRIMARY KEY or UNIQUE constraint to reference', r.tbl, r.col);
    END IF;
  END LOOP;

  IF array_length(v_problems, 1) > 0 THEN
    RAISE EXCEPTION
      '[issue-101-p2] foreign-key referent problem(s): %. Refusing to create anything.',
      array_to_string(v_problems, '; ')
      USING ERRCODE = 'undefined_column';
  END IF;
END
$parity_referents$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION A — public_keys, the DEPENDENCY-ONLY referent.  CREATED FIRST.
-- ─────────────────────────────────────────────────────────────────────────────
-- Not an Issue #101 remediation target and not part of #155's fourteen. It exists here
-- solely so signature_verification_logs can carry its production foreign key.
--
-- Exactly one index is created. The production catalog reported public_keys_pkey twice
-- because it backs two constraints — its own PRIMARY KEY and the incoming FK from
-- signature_verification_logs — but that is one physical index, and the PRIMARY KEY
-- creates it. A second CREATE INDEX would be a fabricated object, not parity.

-- public_keys FIRST: signature_verification_logs references it.

CREATE TABLE public.public_keys (
  id              text NOT NULL,
  user_id         text NOT NULL,
  public_key_pem  text NOT NULL,
  private_key_pem text,
  key_type        text DEFAULT 'secp256k1'::text,
  status          text DEFAULT 'ACTIVE'::text,
  created_at      text NOT NULL,
  revoked_at      text,
  CONSTRAINT public_keys_pkey PRIMARY KEY (id),
  CONSTRAINT public_keys_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text]))),
  CONSTRAINT public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_public_keys_user ON public.public_keys USING btree (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION B — the eleven Issue #101 parity targets.
-- ─────────────────────────────────────────────────────────────────────────────
-- Column order, types, nullability, defaults, PK/UNIQUE/CHECK names and definitions,
-- and FK on-delete/on-update semantics are reproduced verbatim from run 31770747669.
-- Constraint definitions are the measured pg_get_constraintdef output; the only textual
-- change is schema-qualifying REFERENCES targets so resolution cannot depend on
-- search_path.
--
-- The three id columns are bigint with a nextval default over an explicitly created,
-- explicitly owned sequence, rather than the bigserial shorthand, so that every measured
-- sequence parameter is visible and auditable against the receipt.
--
-- Only the eight measured independent indexes are created. The seventeen
-- constraint-created indexes are NOT restated: PRIMARY KEY and UNIQUE build their own,
-- and restating them would double the physical index count.

CREATE TABLE public.cid_clearance_records (
  id                        uuid DEFAULT gen_random_uuid() NOT NULL,
  vin                       text NOT NULL,
  clearance_ref_number      character varying(100) NOT NULL,
  chassis_verified          boolean DEFAULT true NOT NULL,
  engine_number_verified    boolean DEFAULT true NOT NULL,
  interpol_database_queried boolean DEFAULT true NOT NULL,
  stolen_check_status       character varying(20) DEFAULT 'Cleared'::character varying NOT NULL,
  authorized_by_officer     character varying(255) NOT NULL,
  station_name              character varying(100) NOT NULL,
  cleared_at                timestamp with time zone NOT NULL,
  CONSTRAINT cid_clearance_records_pkey PRIMARY KEY (id),
  CONSTRAINT cid_clearance_records_clearance_ref_number_key UNIQUE (clearance_ref_number),
  CONSTRAINT cid_clearance_records_stolen_check_status_check CHECK (((stolen_check_status)::text = ANY ((ARRAY['Cleared'::character varying, 'Flagged_Stolen'::character varying, 'Under_Investigation'::character varying])::text[]))),
  CONSTRAINT cid_clearance_records_vin_fkey FOREIGN KEY (vin) REFERENCES public.vehicles(vin) ON DELETE CASCADE
);

CREATE TABLE public.cvr_ownership_records (
  id                           uuid DEFAULT gen_random_uuid() NOT NULL,
  vin                          text NOT NULL,
  registration_number          character varying(20) NOT NULL,
  owner_id_type                character varying(50),
  owner_id_number              character varying(100) NOT NULL,
  owner_full_name              character varying(255) NOT NULL,
  previous_registration_number character varying(20),
  issue_date                   date NOT NULL,
  logbook_serial_number        character varying(100) NOT NULL,
  status                       character varying(20) DEFAULT 'Current'::character varying,
  CONSTRAINT cvr_ownership_records_pkey PRIMARY KEY (id),
  CONSTRAINT cvr_ownership_records_logbook_serial_number_key UNIQUE (logbook_serial_number),
  CONSTRAINT cvr_ownership_records_registration_number_key UNIQUE (registration_number),
  CONSTRAINT cvr_ownership_records_owner_id_type_check CHECK (((owner_id_type)::text = ANY ((ARRAY['National_ID'::character varying, 'Passport'::character varying, 'Company_Reg'::character varying])::text[]))),
  CONSTRAINT cvr_ownership_records_status_check CHECK (((status)::text = ANY ((ARRAY['Current'::character varying, 'Transferred'::character varying, 'Archived'::character varying, 'Cancelled'::character varying])::text[]))),
  CONSTRAINT cvr_ownership_records_vin_fkey FOREIGN KEY (vin) REFERENCES public.vehicles(vin) ON DELETE CASCADE
);

CREATE TABLE public.ocr_customs_declarations (
  id                          uuid DEFAULT gen_random_uuid() NOT NULL,
  ocr_document_id             text NOT NULL,
  extracted_vin               character varying(17) NOT NULL,
  extracted_bill_entry_number character varying(50) NOT NULL,
  extracted_duty_value_zig    numeric(15,2) NOT NULL,
  extracted_importer_name     character varying(255) NOT NULL,
  extracted_stamp_date        date NOT NULL,
  raw_verification_confidence numeric(4,3) NOT NULL,
  CONSTRAINT ocr_customs_declarations_pkey PRIMARY KEY (id),
  CONSTRAINT ocr_customs_declarations_ocr_document_id_fkey FOREIGN KEY (ocr_document_id) REFERENCES public.ocr_documents(id) ON DELETE CASCADE
);

CREATE TABLE public.ocr_national_ids (
  id                          uuid DEFAULT gen_random_uuid() NOT NULL,
  ocr_document_id             text NOT NULL,
  extracted_first_name        character varying(255) NOT NULL,
  extracted_last_name         character varying(255) NOT NULL,
  national_id_number          character varying(30) NOT NULL,
  date_of_birth               date NOT NULL,
  place_of_birth              character varying(100),
  sex                         character varying(1),
  date_of_issue               date,
  raw_verification_confidence numeric(4,3) NOT NULL,
  CONSTRAINT ocr_national_ids_pkey PRIMARY KEY (id),
  CONSTRAINT ocr_national_ids_sex_check CHECK (((sex)::text = ANY ((ARRAY['M'::character varying, 'F'::character varying])::text[]))),
  CONSTRAINT ocr_national_ids_ocr_document_id_fkey FOREIGN KEY (ocr_document_id) REFERENCES public.ocr_documents(id) ON DELETE CASCADE
);

CREATE TABLE public.ocr_registration_books (
  id                          uuid DEFAULT gen_random_uuid() NOT NULL,
  ocr_document_id             text NOT NULL,
  extracted_vin               character varying(17) NOT NULL,
  extracted_engine_number     character varying(50),
  extracted_make              character varying(100) NOT NULL,
  extracted_model             character varying(100) NOT NULL,
  extracted_year              integer NOT NULL,
  extracted_plate_number      character varying(20) NOT NULL,
  extracted_owner_name        character varying(255) NOT NULL,
  extracted_chassis_number    character varying(100),
  raw_verification_confidence numeric(4,3) NOT NULL,
  CONSTRAINT ocr_registration_books_pkey PRIMARY KEY (id),
  CONSTRAINT ocr_registration_books_ocr_document_id_fkey FOREIGN KEY (ocr_document_id) REFERENCES public.ocr_documents(id) ON DELETE CASCADE
);

CREATE SEQUENCE public.performance_telemetry_id_seq
  AS bigint START WITH 1 INCREMENT BY 1
  MINVALUE 1 MAXVALUE 9223372036854775807
  CACHE 1 NO CYCLE;

CREATE TABLE public.performance_telemetry (
  id              bigint DEFAULT nextval('performance_telemetry_id_seq'::regclass) NOT NULL,
  metric_name     text NOT NULL,
  value           real NOT NULL,
  context_details text,
  timestamp       text NOT NULL,
  CONSTRAINT performance_telemetry_pkey PRIMARY KEY (id)
);

ALTER SEQUENCE public.performance_telemetry_id_seq OWNED BY public.performance_telemetry.id;

CREATE SEQUENCE public.signature_verification_logs_id_seq
  AS bigint START WITH 1 INCREMENT BY 1
  MINVALUE 1 MAXVALUE 9223372036854775807
  CACHE 1 NO CYCLE;

CREATE TABLE public.signature_verification_logs (
  id            bigint DEFAULT nextval('signature_verification_logs_id_seq'::regclass) NOT NULL,
  payload_hash  text NOT NULL,
  signature     text NOT NULL,
  public_key_id text NOT NULL,
  verified      integer DEFAULT 1,
  timestamp     text NOT NULL,
  CONSTRAINT signature_verification_logs_pkey PRIMARY KEY (id),
  CONSTRAINT signature_verification_logs_public_key_id_fkey FOREIGN KEY (public_key_id) REFERENCES public.public_keys(id) ON DELETE CASCADE
);

ALTER SEQUENCE public.signature_verification_logs_id_seq OWNED BY public.signature_verification_logs.id;

CREATE SEQUENCE public.system_failures_id_seq
  AS bigint START WITH 1 INCREMENT BY 1
  MINVALUE 1 MAXVALUE 9223372036854775807
  CACHE 1 NO CYCLE;

CREATE TABLE public.system_failures (
  id            bigint DEFAULT nextval('system_failures_id_seq'::regclass) NOT NULL,
  error_message text NOT NULL,
  stack_trace   text,
  severity      text,
  timestamp     text NOT NULL,
  CONSTRAINT system_failures_pkey PRIMARY KEY (id),
  CONSTRAINT system_failures_severity_check CHECK ((severity = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text])))
);

ALTER SEQUENCE public.system_failures_id_seq OWNED BY public.system_failures.id;

CREATE TABLE public.vid_inspections (
  id                        uuid DEFAULT gen_random_uuid() NOT NULL,
  vin                       text NOT NULL,
  inspection_center         character varying(100) NOT NULL,
  odometer_reading          integer NOT NULL,
  braking_efficiency_pct    numeric(5,2) NOT NULL,
  suspension_passed         boolean DEFAULT true NOT NULL,
  steering_passed           boolean DEFAULT true NOT NULL,
  exhaust_emissions_rating  character varying(10),
  lights_passed             boolean DEFAULT true NOT NULL,
  chassis_verified          boolean DEFAULT true NOT NULL,
  inspection_status         character varying(20) NOT NULL,
  certificate_serial_number character varying(100),
  inspector_id              text,
  inspected_at              timestamp with time zone NOT NULL,
  CONSTRAINT vid_inspections_pkey PRIMARY KEY (id),
  CONSTRAINT vid_inspections_certificate_serial_number_key UNIQUE (certificate_serial_number),
  CONSTRAINT vid_inspections_exhaust_emissions_rating_check CHECK (((exhaust_emissions_rating)::text = ANY ((ARRAY['Pass'::character varying, 'Borderline'::character varying, 'Fail'::character varying])::text[]))),
  CONSTRAINT vid_inspections_inspection_status_check CHECK (((inspection_status)::text = ANY ((ARRAY['Passed'::character varying, 'Roadworthy_Conditional'::character varying, 'Failed_Unroadworthy'::character varying])::text[]))),
  CONSTRAINT vid_inspections_inspector_id_fkey FOREIGN KEY (inspector_id) REFERENCES public.users(id),
  CONSTRAINT vid_inspections_vin_fkey FOREIGN KEY (vin) REFERENCES public.vehicles(vin) ON DELETE CASCADE
);

CREATE TABLE public.zimra_declarations (
  id                     uuid DEFAULT gen_random_uuid() NOT NULL,
  vin                    text NOT NULL,
  customs_ref_number     character varying(100) NOT NULL,
  importer_name          character varying(255) NOT NULL,
  port_of_entry          character varying(100) NOT NULL,
  duty_calculated_zig    numeric(15,2) NOT NULL,
  duty_paid_zig          numeric(15,2) NOT NULL,
  exchange_rate_used     numeric(12,4) NOT NULL,
  customs_stamp_date     date NOT NULL,
  officer_signature_hash character varying(64) NOT NULL,
  verified_at            timestamp with time zone DEFAULT now(),
  CONSTRAINT zimra_declarations_pkey PRIMARY KEY (id),
  CONSTRAINT zimra_declarations_customs_ref_number_key UNIQUE (customs_ref_number),
  CONSTRAINT zimra_declarations_vin_fkey FOREIGN KEY (vin) REFERENCES public.vehicles(vin) ON DELETE CASCADE
);

CREATE TABLE public.zinara_licensing_records (
  id                          uuid DEFAULT gen_random_uuid() NOT NULL,
  vin                         text NOT NULL,
  plate_number                character varying(20) NOT NULL,
  licensing_term_start        date NOT NULL,
  licensing_term_end          date NOT NULL,
  receipt_number              character varying(100) NOT NULL,
  amount_paid_zig             numeric(12,2) NOT NULL,
  status                      character varying(20),
  tollgate_checkpoints_passed integer DEFAULT 0,
  last_tollgate_seen_at       timestamp with time zone,
  CONSTRAINT zinara_licensing_records_pkey PRIMARY KEY (id),
  CONSTRAINT zinara_licensing_records_receipt_number_key UNIQUE (receipt_number),
  CONSTRAINT zinara_licensing_records_status_check CHECK (((status)::text = ANY ((ARRAY['Current'::character varying, 'Arrears'::character varying, 'Exempted'::character varying])::text[]))),
  CONSTRAINT zinara_licensing_records_vin_fkey FOREIGN KEY (vin) REFERENCES public.vehicles(vin) ON DELETE CASCADE
);

CREATE INDEX idx_cid_vin ON public.cid_clearance_records USING btree (vin);
CREATE INDEX idx_cvr_vin ON public.cvr_ownership_records USING btree (vin);
CREATE INDEX idx_ocr_customs_ref ON public.ocr_customs_declarations USING btree (ocr_document_id);
CREATE INDEX idx_ocr_nid_ref ON public.ocr_national_ids USING btree (ocr_document_id);
CREATE INDEX idx_ocr_regbook_ref ON public.ocr_registration_books USING btree (ocr_document_id);
CREATE INDEX idx_vid_vin ON public.vid_inspections USING btree (vin);
CREATE INDEX idx_zimra_vin ON public.zimra_declarations USING btree (vin);
CREATE INDEX idx_zinara_vin ON public.zinara_licensing_records USING btree (vin);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION C — sequence exposure, closed at birth.  DOES NOT TOUCH B1-SEQ.
-- ─────────────────────────────────────────────────────────────────────────────
-- Staging's default privileges are broadly permissive: all eight pre-existing public
-- sequences carry anon=rwU and authenticated=rwU, which is exactly the B1-SEQ finding.
-- A newly created sequence inherits the same default grants, so without this section the
-- three sequences created above would be born with the defect this programme is trying
-- to remove.
--
-- These REVOKEs name ONLY the three sequences created by this migration. The eight
-- pre-existing sequences are deliberately untouched — B1-SEQ is a separate remediation
-- lane with its own review, and widening this migration into it would make both harder
-- to reason about. A test asserts existing_staging_sequences_modified = 0.
REVOKE ALL ON SEQUENCE public.performance_telemetry_id_seq       FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.signature_verification_logs_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.system_failures_id_seq             FROM anon, authenticated;

-- Revoked from service_role first for the same reason as public_keys: the permissive
-- default would otherwise hand it ALL, and the grant below would narrow nothing.
-- nextval needs USAGE and currval needs SELECT, which covers ordinary inserts. UPDATE
-- is deliberately withheld — it is only required by setval, which no backend path calls.
REVOKE ALL ON SEQUENCE public.performance_telemetry_id_seq       FROM service_role;
REVOKE ALL ON SEQUENCE public.signature_verification_logs_id_seq FROM service_role;
REVOKE ALL ON SEQUENCE public.system_failures_id_seq             FROM service_role;

GRANT  USAGE, SELECT ON SEQUENCE public.performance_telemetry_id_seq       TO service_role;
GRANT  USAGE, SELECT ON SEQUENCE public.signature_verification_logs_id_seq TO service_role;
GRANT  USAGE, SELECT ON SEQUENCE public.system_failures_id_seq             TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION D — RLS and ACL posture for all twelve.  SAME TRANSACTION.
-- ─────────────────────────────────────────────────────────────────────────────
-- Two controls per table, not one. Enabling RLS closes ordinary SELECT/INSERT/UPDATE/
-- DELETE for anon and authenticated; it does NOT govern TRUNCATE, so REVOKE is the only
-- control for that bit. Both run here, in the same transaction as the CREATEs, so the
-- tables never exist in an exposed state — not even briefly.
--
-- No anon or authenticated policy is created anywhere. Default-deny is the intended end
-- state for all twelve; none has a demonstrated public-read consumer. #155's single
-- public-read exception is evidence_class_taxonomy, which already exists on staging and
-- is not one of these twelve — it is deliberately not duplicated here.
--
-- FORCE ROW LEVEL SECURITY is omitted, matching #155 and production: it constrains the
-- table OWNER, not ordinary roles, and changing that is a separate decision.

-- public_keys — narrower than the rest, because it holds key material. The backend
-- calls select, insert and update on it (backend/services/blockchain/blockchainService.js)
-- and never delete or truncate, so those are not granted.
--
-- The REVOKE from service_role is NOT redundant. Staging carries permissive ALTER
-- DEFAULT PRIVILEGES, so a newly created table arrives with service_role already
-- holding ALL; granting three privileges on top of that would narrow nothing. Revoking
-- first makes the resulting grant exactly what is stated, whatever the default was.
--
-- Withholding DELETE does NOT break the two cascades that reach this table. A
-- referential action runs with the privileges of the referencing table's owner, not
-- those of the role that issued the DELETE, so users → public_keys and
-- public_keys → signature_verification_logs both still cascade. The parity harness
-- proves exactly that rather than asserting it.
ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_keys FROM anon, authenticated;
REVOKE ALL ON TABLE public.public_keys FROM service_role;
GRANT  SELECT, INSERT, UPDATE ON TABLE public.public_keys TO service_role;

-- The eleven — GRANT ALL to service_role, matching #155 exactly so that its own
-- re-grant is a confirming no-op rather than a change.
ALTER TABLE public.cid_clearance_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cvr_ownership_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_customs_declarations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_national_ids            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_registration_books      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_telemetry       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_verification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_failures             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vid_inspections             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zimra_declarations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zinara_licensing_records    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cid_clearance_records       FROM anon, authenticated;
REVOKE ALL ON TABLE public.cvr_ownership_records       FROM anon, authenticated;
REVOKE ALL ON TABLE public.ocr_customs_declarations    FROM anon, authenticated;
REVOKE ALL ON TABLE public.ocr_national_ids            FROM anon, authenticated;
REVOKE ALL ON TABLE public.ocr_registration_books      FROM anon, authenticated;
REVOKE ALL ON TABLE public.performance_telemetry       FROM anon, authenticated;
REVOKE ALL ON TABLE public.signature_verification_logs FROM anon, authenticated;
REVOKE ALL ON TABLE public.system_failures             FROM anon, authenticated;
REVOKE ALL ON TABLE public.vid_inspections             FROM anon, authenticated;
REVOKE ALL ON TABLE public.zimra_declarations          FROM anon, authenticated;
REVOKE ALL ON TABLE public.zinara_licensing_records    FROM anon, authenticated;

GRANT  ALL ON TABLE public.cid_clearance_records       TO service_role;
GRANT  ALL ON TABLE public.cvr_ownership_records       TO service_role;
GRANT  ALL ON TABLE public.ocr_customs_declarations    TO service_role;
GRANT  ALL ON TABLE public.ocr_national_ids            TO service_role;
GRANT  ALL ON TABLE public.ocr_registration_books      TO service_role;
GRANT  ALL ON TABLE public.performance_telemetry       TO service_role;
GRANT  ALL ON TABLE public.signature_verification_logs TO service_role;
GRANT  ALL ON TABLE public.system_failures             TO service_role;
GRANT  ALL ON TABLE public.vid_inspections             TO service_role;
GRANT  ALL ON TABLE public.zimra_declarations          TO service_role;
GRANT  ALL ON TABLE public.zinara_licensing_records    TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- POSTCONDITION — prove what was built before the transaction is allowed to commit.
-- ─────────────────────────────────────────────────────────────────────────────
-- A migration that half-succeeds is worse than one that fails. These counts come from
-- the same receipts that generated the DDL above, so a hand-edit that adds, drops or
-- renames anything fails here and rolls the whole transaction back.
DO $parity_postcondition$
DECLARE
  v_tables  integer;
  v_cols    integer;
  v_fks     integer;
  v_idx     integer;
  v_seqs    integer;
  v_rls     integer;
  v_exposed integer;
  v_pol     integer;
BEGIN
  SELECT count(*) INTO v_tables
    FROM unnest(ARRAY['public_keys',
      'cid_clearance_records',
      'cvr_ownership_records',
      'ocr_customs_declarations',
      'ocr_national_ids',
      'ocr_registration_books',
      'performance_telemetry',
      'signature_verification_logs',
      'system_failures',
      'vid_inspections',
      'zimra_declarations',
      'zinara_licensing_records']) AS name
   WHERE to_regclass('public.' || name) IS NOT NULL;

  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = ANY (ARRAY['public_keys',
      'cid_clearance_records',
      'cvr_ownership_records',
      'ocr_customs_declarations',
      'ocr_national_ids',
      'ocr_registration_books',
      'performance_telemetry',
      'signature_verification_logs',
      'system_failures',
      'vid_inspections',
      'zimra_declarations',
      'zinara_licensing_records']);

  SELECT count(*) INTO v_fks
    FROM pg_constraint pc
    JOIN pg_class pcl ON pcl.oid = pc.conrelid
    JOIN pg_namespace pn ON pn.oid = pcl.relnamespace
   WHERE pn.nspname = 'public' AND pc.contype = 'f'
     AND pcl.relname = ANY (ARRAY['public_keys',
      'cid_clearance_records',
      'cvr_ownership_records',
      'ocr_customs_declarations',
      'ocr_national_ids',
      'ocr_registration_books',
      'performance_telemetry',
      'signature_verification_logs',
      'system_failures',
      'vid_inspections',
      'zimra_declarations',
      'zinara_licensing_records']);

  -- physical indexes, counted as objects: 17 constraint-created for the eleven,
  -- 1 for public_keys' PRIMARY KEY, plus the 9 independent ones.
  SELECT count(*) INTO v_idx
    FROM pg_class ic
    JOIN pg_index pi ON pi.indexrelid = ic.oid
    JOIN pg_class tc ON tc.oid = pi.indrelid
    JOIN pg_namespace pn ON pn.oid = tc.relnamespace
   WHERE pn.nspname = 'public' AND tc.relname = ANY (ARRAY['public_keys',
      'cid_clearance_records',
      'cvr_ownership_records',
      'ocr_customs_declarations',
      'ocr_national_ids',
      'ocr_registration_books',
      'performance_telemetry',
      'signature_verification_logs',
      'system_failures',
      'vid_inspections',
      'zimra_declarations',
      'zinara_licensing_records']);

  SELECT count(*) INTO v_seqs
    FROM pg_class sc
    JOIN pg_namespace sn ON sn.oid = sc.relnamespace
   WHERE sn.nspname = 'public' AND sc.relkind = 'S'
     AND sc.relname = ANY (ARRAY['performance_telemetry_id_seq',
                                 'signature_verification_logs_id_seq',
                                 'system_failures_id_seq']);

  SELECT count(*) INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relrowsecurity
     AND c.relname = ANY (ARRAY['public_keys',
      'cid_clearance_records',
      'cvr_ownership_records',
      'ocr_customs_declarations',
      'ocr_national_ids',
      'ocr_registration_books',
      'performance_telemetry',
      'signature_verification_logs',
      'system_failures',
      'vid_inspections',
      'zimra_declarations',
      'zinara_licensing_records']);

  SELECT count(*) INTO v_exposed
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    JOIN pg_roles g ON g.oid = a.grantee
   WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY['public_keys',
      'cid_clearance_records',
      'cvr_ownership_records',
      'ocr_customs_declarations',
      'ocr_national_ids',
      'ocr_registration_books',
      'performance_telemetry',
      'signature_verification_logs',
      'system_failures',
      'vid_inspections',
      'zimra_declarations',
      'zinara_licensing_records'])
     AND g.rolname IN ('anon', 'authenticated');

  SELECT count(*) INTO v_pol
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY['public_keys',
      'cid_clearance_records',
      'cvr_ownership_records',
      'ocr_customs_declarations',
      'ocr_national_ids',
      'ocr_registration_books',
      'performance_telemetry',
      'signature_verification_logs',
      'system_failures',
      'vid_inspections',
      'zimra_declarations',
      'zinara_licensing_records']);

  IF v_tables <> 12 THEN
    RAISE EXCEPTION '[issue-101-p2] expected 12 relations, found %', v_tables;
  END IF;
  IF v_cols <> 108 THEN
    RAISE EXCEPTION '[issue-101-p2] expected 108 columns (100 + 8), found %', v_cols;
  END IF;
  IF v_fks <> 11 THEN
    RAISE EXCEPTION '[issue-101-p2] expected 11 foreign keys (10 + public_keys->users), found %', v_fks;
  END IF;
  IF v_idx <> 27 THEN
    RAISE EXCEPTION '[issue-101-p2] expected 27 physical indexes (17 constraint-created + 1 public_keys pkey + 9 independent), found %', v_idx;
  END IF;
  IF v_seqs <> 3 THEN
    RAISE EXCEPTION '[issue-101-p2] expected 3 new owned sequences, found %', v_seqs;
  END IF;
  IF v_rls <> 12 THEN
    RAISE EXCEPTION '[issue-101-p2] expected RLS enabled on all 12, found %', v_rls;
  END IF;
  IF v_exposed <> 0 THEN
    RAISE EXCEPTION '[issue-101-p2] % anon/authenticated privilege(s) survive on the twelve; expected 0', v_exposed;
  END IF;
  IF v_pol <> 0 THEN
    RAISE EXCEPTION '[issue-101-p2] expected 0 policies on the twelve, found %', v_pol;
  END IF;
END
$parity_postcondition$;

-- +migrate Down
-- Reverse dependency order: the eleven first, then public_keys, which
-- signature_verification_logs references. The three sequences are OWNED BY their
-- columns and are dropped with their tables; no other sequence is named, so B1-SEQ's
-- eight pre-existing sequences cannot be affected by a rollback either.
DROP TABLE IF EXISTS public.signature_verification_logs;
DROP TABLE IF EXISTS public.cid_clearance_records;
DROP TABLE IF EXISTS public.cvr_ownership_records;
DROP TABLE IF EXISTS public.ocr_customs_declarations;
DROP TABLE IF EXISTS public.ocr_national_ids;
DROP TABLE IF EXISTS public.ocr_registration_books;
DROP TABLE IF EXISTS public.performance_telemetry;
DROP TABLE IF EXISTS public.system_failures;
DROP TABLE IF EXISTS public.vid_inspections;
DROP TABLE IF EXISTS public.zimra_declarations;
DROP TABLE IF EXISTS public.zinara_licensing_records;
DROP TABLE IF EXISTS public.public_keys;
