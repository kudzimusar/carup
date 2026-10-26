/**
 * A PGlite world shaped like the REAL staging catalog, for rehearsing the T11-CAP convergence harness.
 *
 * What makes it realistic, and why each part is here:
 *   · the shared `communication_domain_event_dedupe_key()` is the LIVE body (read from staging on 2026-10-25): Email 1.0,
 *     Service Network O4 and Garage 1.0 branches. A rehearsal against Email 1.0's body alone is how the first CAP-08
 *     migration passed its own check while being able to delete two other lineages' branches;
 *   · a second trigger on domain_events (referral-bridge payload minimisation), as staging has;
 *   · Supabase's default privileges (EXECUTE on new functions, ALL on new tables, to anon/authenticated/service_role).
 *     Without them a missing REVOKE is invisible, because a bare Postgres grants those roles nothing.
 */
import { PGlite } from '@electric-sql/pglite';

export const LIVE_SHARED_FUNCTION_BODY = `
DECLARE
  v_inquiry_id TEXT;
  v_fingerprint TEXT;
  v_recipient TEXT;
  v_service_case_id TEXT;
  v_notification_key TEXT;
BEGIN
  IF NEW.event_type = 'marketplace.inquiry.created' THEN
    v_inquiry_id := NULLIF(NEW.payload ->> 'inquiryId', '');
    IF v_inquiry_id IS NOT NULL THEN
      NEW.dedupe_key := 'marketplace.inquiry.created:' || v_inquiry_id;
    END IF;
  ELSIF NEW.event_type = 'user.email.verified' THEN
    v_recipient := NULLIF(NEW.payload ->> 'recipientUserId', '');
    IF v_recipient IS NOT NULL THEN
      NEW.dedupe_key := 'user.email.verified:' || v_recipient;
    END IF;
  ELSIF NEW.event_type = 'vehicle.trust.presentation_changed' THEN
    v_fingerprint := NULLIF(NEW.payload ->> 'presentation_fingerprint', '');
    IF v_fingerprint IS NOT NULL THEN
      NEW.dedupe_key := 'vehicle.trust.presentation_changed:' || v_fingerprint;
    END IF;
  ELSIF NEW.event_type IN (
    'service.case.requested',
    'service.case.accepted',
    'service.case.declined',
    'service.case.cancelled',
    'service.case.completed',
    'service.work.started'
  ) THEN
    v_service_case_id := NULLIF(NEW.payload ->> 'serviceCaseId', '');
    IF v_service_case_id IS NOT NULL THEN
      NEW.dedupe_key := NEW.event_type || ':' || v_service_case_id;
    END IF;
  ELSIF NEW.event_type IN (
    'garage.estimate.sent',
    'garage.invoice.issued',
    'garage.payment.recorded',
    'garage.appointment.confirmed',
    'garage.appointment.declined',
    'garage.appointment.cancelled'
  ) THEN
    v_notification_key := NULLIF(NEW.payload ->> 'notificationKey', '');
    IF v_notification_key IS NOT NULL THEN
      NEW.dedupe_key := NEW.event_type || ':' || v_notification_key;
    END IF;
  END IF;
  RETURN NEW;
END;
`;

/** A staging-shaped database with none of the three CAP migrations applied. */
export async function stagingWorld({ sharedFunction = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations (
      version text PRIMARY KEY, name text, statements text[], created_by text, idempotency_key text, rollback text[]
    );
    INSERT INTO supabase_migrations.schema_migrations (version, name, created_by)
      VALUES ('20261024140000', 'garage_communications_events_and_template', 'garage-1.0-final-campaign');

    CREATE TABLE public.tenants (id uuid PRIMARY KEY);
    CREATE TABLE public.users (id text PRIMARY KEY);
    CREATE TABLE public.diaspora_shipments (id uuid PRIMARY KEY, tenant_id uuid, status text, departure_date timestamptz, estimated_arrival_date timestamptz, actual_arrival_date timestamptz);
    CREATE TABLE public.diaspora_shipment_stage_events (id uuid PRIMARY KEY);

    CREATE TABLE public.domain_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'pending', attempts int NOT NULL DEFAULT 0, tenant_id text NULL,
      dedupe_key text NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX idx_domain_events_dedupe_key ON public.domain_events (dedupe_key) WHERE dedupe_key IS NOT NULL;

    CREATE TABLE public.communication_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_key text NOT NULL UNIQUE,
      business_workflow text, stakeholder_audience text, classification text, owner_team text,
      status text NOT NULL DEFAULT 'active', metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.communication_template_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES public.communication_templates(id),
      version int NOT NULL, channel text NOT NULL, language text NOT NULL, subject_template text, body_template text,
      required_variables jsonb, optional_variables jsonb, approval_status text, experiment_metadata jsonb,
      UNIQUE (template_id, version, channel, language)
    );
    INSERT INTO public.communication_templates (template_key, business_workflow, stakeholder_audience, classification, owner_team)
      VALUES ('logistics_update_v1', 'container_logistics', 'customer', 'transactional', 'logistics');

    CREATE FUNCTION public.enforce_referral_bridge_outbox_payload_minimization() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_type = 'marketplace.inquiry.referral_bridge_requested' THEN NEW.payload := NEW.payload; END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER trg_minimize_referral_bridge_outbox_payload BEFORE INSERT OR UPDATE OF event_type, payload ON public.domain_events
      FOR EACH ROW EXECUTE FUNCTION public.enforce_referral_bridge_outbox_payload_minimization();
  `);
  if (sharedFunction) {
    await db.exec(`CREATE FUNCTION public.communication_domain_event_dedupe_key() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$${LIVE_SHARED_FUNCTION_BODY}$$;`);
    await db.exec(`CREATE TRIGGER trg_domain_events_communication_dedupe BEFORE INSERT ON public.domain_events
      FOR EACH ROW EXECUTE FUNCTION public.communication_domain_event_dedupe_key();`);
  }
  return db;
}
