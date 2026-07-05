-- +migrate Up
-- Enterprise inbox: identity-first projection VIEW + server-side search/keyset-pagination/count
-- RPCs + supporting indexes. Fully additive and backward-compatible: no existing table is altered;
-- only a view, two functions, and indexes are added. (Command Center plan §7; issue #107.)

-- ── Indexes for the query plan ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_message_threads_tenant_lastmsg ON message_threads (tenant_id, last_message_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_message_threads_status_lastmsg ON message_threads (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_threads_assigned_admin ON message_threads (assigned_admin_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created_desc ON messages (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_participants_thread_requester ON message_participants (thread_id, role);

-- ── Identity-first projection ─────────────────────────────────────────────────
-- One row per thread: requester identity, latest message, and unread count (derived from
-- message_participants.last_read_at — no new table needed), plus failed-outbound risk.
CREATE OR REPLACE VIEW communication_inbox_threads AS
SELECT
  t.id, t.tenant_id, t.thread_type, t.status, t.priority, t.primary_channel,
  t.assigned_admin_id, t.assigned_team, t.sla_due_at, t.last_message_at, t.updated_at, t.created_at,
  t.thread_key, t.subject_type, t.subject_id, t.marketplace_listing_id, t.escrow_id,
  t.financing_application_id, t.primary_user_id, t.ai_mode,
  -- Registered-user identity fallback (P1.8/#3): when there is no requester channel identity, show the
  -- CarUp user profile name. Raw email/phone are NOT exposed as list columns (kept masked in the UI);
  -- they are searchable via the RPC's users join below.
  COALESCE(ci.display_name, usr.name) AS identity_display_name,
  ci.normalized_address AS identity_address,
  ci.external_id        AS identity_external_id,
  COALESCE(ci.verified, CASE WHEN usr.id IS NOT NULL THEN true ELSE NULL END) AS identity_verified,
  COALESCE(ci.channel, t.primary_channel) AS identity_channel,
  ci.provider           AS identity_provider,
  COALESCE(usr.id, t.primary_user_id) AS identity_user_id,
  lm.content_text       AS latest_message_text,
  lm.direction          AS latest_message_direction,
  lm.created_at         AS latest_message_at,
  lm.status             AS latest_message_status,
  lm.provider_message_id AS latest_provider_message_id,
  -- TEAM-level unread (inbound after the most recent read by ANY agent). Named explicitly so no
  -- caller mistakes it for per-agent unread (#7). Per-agent unread is computed separately: the
  -- backend re-projects the page, and communication_thread_agent_unread() gives the DB-path answer.
  COALESCE(u.unread_count, 0) AS team_unread_count,
  (SELECT COUNT(*) FROM messages mx
     WHERE mx.thread_id = t.id AND lower(mx.direction) = 'outbound'
       AND lower(mx.status) IN ('failed', 'dead_letter', 'retry_scheduled')) AS failed_outbound_count
FROM message_threads t
LEFT JOIN LATERAL (
  SELECT p.external_identity_id, p.last_read_at
  FROM message_participants p
  WHERE p.thread_id = t.id AND p.role = 'requester'
  ORDER BY p.joined_at ASC NULLS LAST, p.id ASC   -- deterministic tie-break on equal/absent joined_at
  LIMIT 1
) rp ON true
LEFT JOIN channel_identities ci ON ci.id = rp.external_identity_id
-- Registered CarUp user profile (users.id is TEXT, matching message_threads.primary_user_id).
LEFT JOIN users usr ON usr.id = t.primary_user_id
LEFT JOIN LATERAL (
  SELECT m.content_text, m.direction, m.created_at, m.status, m.provider_message_id
  FROM messages m WHERE m.thread_id = t.id
  ORDER BY m.created_at DESC, m.id DESC           -- deterministic tie-break on equal created_at
  LIMIT 1
) lm ON true
-- Agent-side read marker: the most recent time ANY agent/assignee (role <> requester) read the
-- thread. Unread-for-the-team = inbound messages that arrived after that (or all inbound if no agent
-- has ever opened it). The requester participant's last_read_at is the CUSTOMER's receipt and must
-- not drive the team inbox badge.
LEFT JOIN LATERAL (
  SELECT MAX(ap.last_read_at) AS agent_last_read
  FROM message_participants ap
  WHERE ap.thread_id = t.id AND ap.role <> 'requester'
) ar ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS unread_count
  FROM messages m2
  WHERE m2.thread_id = t.id AND lower(m2.direction) = 'inbound'
    AND (ar.agent_last_read IS NULL OR m2.created_at > ar.agent_last_read)
) u ON true;

-- ── Server-side search + keyset pagination ────────────────────────────────────
-- Keyset ordering: newest first (last_message_at DESC, id DESC). Tenant-scoped unless platform.
CREATE OR REPLACE FUNCTION search_communication_threads(
  p_tenant_id TEXT DEFAULT NULL,
  p_is_platform BOOLEAN DEFAULT FALSE,
  p_search TEXT DEFAULT NULL,
  p_status TEXT[] DEFAULT NULL,
  p_channel TEXT[] DEFAULT NULL,
  p_assignee TEXT DEFAULT NULL,
  p_team TEXT DEFAULT NULL,
  p_sla TEXT DEFAULT NULL,
  p_unassigned BOOLEAN DEFAULT FALSE,
  p_assigned_only BOOLEAN DEFAULT FALSE,
  p_failed_only BOOLEAN DEFAULT FALSE,
  p_include_terminal BOOLEAN DEFAULT TRUE,
  p_cursor_ts TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS SETOF communication_inbox_threads
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Join the registered user profile so search can match a registered customer by name/email/phone
  -- even when the thread has no requester channel identity (#3). Only v.* is returned — the raw
  -- email/phone are searchable but never exposed in the result set (kept masked in the UI).
  SELECT v.* FROM communication_inbox_threads v
  LEFT JOIN users u2 ON u2.id = v.primary_user_id
  WHERE (p_is_platform OR (p_tenant_id IS NOT NULL AND v.tenant_id = p_tenant_id))
    AND (p_include_terminal OR lower(v.status) NOT IN ('resolved', 'closed', 'spam'))
    AND (p_status IS NULL OR v.status = ANY(p_status))
    AND (p_channel IS NULL OR lower(v.primary_channel) = ANY(SELECT lower(x) FROM unnest(p_channel) x))
    AND (p_assignee IS NULL OR v.assigned_admin_id = p_assignee)
    AND (p_team IS NULL OR v.assigned_team = p_team)
    AND (NOT p_unassigned OR (v.assigned_admin_id IS NULL AND v.assigned_team IS NULL))
    AND (NOT p_assigned_only OR (v.assigned_admin_id IS NOT NULL OR v.assigned_team IS NOT NULL))
    AND (NOT p_failed_only OR v.failed_outbound_count > 0)
    AND (p_sla IS NULL OR (
      (p_sla = 'breach'    AND v.sla_due_at IS NOT NULL AND v.sla_due_at < now() AND lower(v.status) NOT IN ('resolved','closed','spam'))
      OR (p_sla = 'due_soon' AND v.sla_due_at IS NOT NULL AND v.sla_due_at >= now() AND v.sla_due_at < now() + interval '15 minutes')
      OR (p_sla = 'healthy'  AND v.sla_due_at IS NOT NULL AND v.sla_due_at >= now() + interval '15 minutes')
    ))
    -- Search field set is kept in exact sync with the window engine's SEARCH_FIELDS
    -- (communicationThreadQuery.js) so the RPC and window paths return identical matches. v.id is a
    -- UUID and must be cast for ILIKE.
    AND (p_search IS NULL OR p_search = '' OR (
      v.identity_display_name       ILIKE '%' || p_search || '%'
      OR v.identity_address         ILIKE '%' || p_search || '%'
      OR v.identity_external_id     ILIKE '%' || p_search || '%'
      OR v.latest_message_text      ILIKE '%' || p_search || '%'
      OR v.thread_key               ILIKE '%' || p_search || '%'
      OR v.thread_type              ILIKE '%' || p_search || '%'
      OR v.id::text                 ILIKE '%' || p_search || '%'
      OR v.subject_type             ILIKE '%' || p_search || '%'
      OR v.subject_id               ILIKE '%' || p_search || '%'
      OR v.marketplace_listing_id   ILIKE '%' || p_search || '%'
      OR v.escrow_id                ILIKE '%' || p_search || '%'
      OR v.financing_application_id ILIKE '%' || p_search || '%'
      OR v.assigned_team            ILIKE '%' || p_search || '%'
      OR v.assigned_admin_id        ILIKE '%' || p_search || '%'
      OR v.latest_provider_message_id ILIKE '%' || p_search || '%'
      -- Registered CarUp user profile (searchable, not returned): name, email, phone.
      OR u2.name  ILIKE '%' || p_search || '%'
      OR u2.email ILIKE '%' || p_search || '%'
      OR u2.phone ILIKE '%' || p_search || '%'
    ))
    -- Keyset: v.id is UUID; the cursor id arrives as TEXT and must be cast (there is no uuid < text
    -- operator, so an uncast comparison fails to create the function and rolls back the migration).
    AND (p_cursor_ts IS NULL OR (
      COALESCE(v.last_message_at, v.created_at) < p_cursor_ts
      OR (COALESCE(v.last_message_at, v.created_at) = p_cursor_ts AND v.id < p_cursor_id::uuid)
    ))
  ORDER BY COALESCE(v.last_message_at, v.created_at) DESC, v.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

-- ── Aggregate counts (independent of the current page) ────────────────────────
CREATE OR REPLACE FUNCTION communication_thread_counts(
  p_tenant_id TEXT DEFAULT NULL,
  p_is_platform BOOLEAN DEFAULT FALSE,
  p_user_id TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH scoped AS (
    SELECT * FROM communication_inbox_threads v
    WHERE (p_is_platform OR (p_tenant_id IS NOT NULL AND v.tenant_id = p_tenant_id))
  ), active AS (
    SELECT * FROM scoped WHERE lower(status) NOT IN ('resolved', 'closed', 'spam')
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM scoped),
    'all_active', (SELECT COUNT(*) FROM active),
    'unassigned', (SELECT COUNT(*) FROM active WHERE assigned_admin_id IS NULL AND assigned_team IS NULL),
    'mine', (SELECT COUNT(*) FROM active WHERE assigned_admin_id = p_user_id),
    'awaiting_human', (SELECT COUNT(*) FROM scoped WHERE status = 'awaiting_human'),
    'awaiting_ai', (SELECT COUNT(*) FROM scoped WHERE status = 'awaiting_ai'),
    'awaiting_user', (SELECT COUNT(*) FROM scoped WHERE status = 'awaiting_user'),
    'escalated', (SELECT COUNT(*) FROM scoped WHERE status = 'escalated'),
    'resolved', (SELECT COUNT(*) FROM scoped WHERE status = 'resolved'),
    'sla_breach', (SELECT COUNT(*) FROM active WHERE sla_due_at IS NOT NULL AND sla_due_at < now()),
    'failed_risk', (SELECT COUNT(*) FROM scoped WHERE failed_outbound_count > 0),
    'by_workflow', (SELECT COALESCE(json_object_agg(status, c), '{}'::json) FROM (SELECT status, COUNT(*) c FROM scoped GROUP BY status) s),
    'by_channel', (SELECT COALESCE(json_object_agg(primary_channel, c), '{}'::json) FROM (SELECT primary_channel, COUNT(*) c FROM scoped WHERE primary_channel IS NOT NULL GROUP BY primary_channel) s)
  );
$$;

-- ── Per-agent unread (#7) ─────────────────────────────────────────────────────
-- The view's team_unread_count is a TEAM signal. This function answers the per-agent question the
-- inbox badge actually asks: for THIS agent (p_user_id), how many inbound messages arrived after
-- *their own* last_read_at? An agent who has never opened the thread sees every inbound as unread;
-- when they read, their count drops to 0 while a colleague who has not read still sees non-zero.
-- Returns one row per requested thread (2 columns only — no fragile row-type enumeration).
CREATE OR REPLACE FUNCTION communication_thread_agent_unread(
  p_thread_ids UUID[],
  p_user_id TEXT
)
RETURNS TABLE(thread_id UUID, unread_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id AS thread_id,
    (SELECT COUNT(*) FROM messages m
       WHERE m.thread_id = t.id AND lower(m.direction) = 'inbound'
         AND (ap.last_read_at IS NULL OR m.created_at > ap.last_read_at))::bigint AS unread_count
  FROM message_threads t
  LEFT JOIN message_participants ap
    ON ap.thread_id = t.id AND ap.role <> 'requester'
       AND (ap.admin_id = p_user_id OR ap.user_id = p_user_id)
  WHERE t.id = ANY(p_thread_ids);
$$;

REVOKE ALL ON FUNCTION communication_thread_agent_unread(UUID[], TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION communication_thread_agent_unread(UUID[], TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION communication_thread_agent_unread(UUID[], TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION communication_thread_agent_unread(UUID[], TEXT) TO service_role;

REVOKE ALL ON FUNCTION search_communication_threads(TEXT, BOOLEAN, TEXT, TEXT[], TEXT[], TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION search_communication_threads(TEXT, BOOLEAN, TEXT, TEXT[], TEXT[], TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION search_communication_threads(TEXT, BOOLEAN, TEXT, TEXT[], TEXT[], TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION search_communication_threads(TEXT, BOOLEAN, TEXT, TEXT[], TEXT[], TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION communication_thread_counts(TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION communication_thread_counts(TEXT, BOOLEAN, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION communication_thread_counts(TEXT, BOOLEAN, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION communication_thread_counts(TEXT, BOOLEAN, TEXT) TO service_role;

-- +migrate Down
DROP FUNCTION IF EXISTS search_communication_threads(TEXT, BOOLEAN, TEXT, TEXT[], TEXT[], TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT, INTEGER);
DROP FUNCTION IF EXISTS communication_thread_agent_unread(UUID[], TEXT);
DROP FUNCTION IF EXISTS communication_thread_counts(TEXT, BOOLEAN, TEXT);
DROP VIEW IF EXISTS communication_inbox_threads;
DROP INDEX IF EXISTS idx_message_threads_tenant_lastmsg;
DROP INDEX IF EXISTS idx_message_threads_status_lastmsg;
DROP INDEX IF EXISTS idx_message_threads_assigned_admin;
DROP INDEX IF EXISTS idx_messages_thread_created_desc;
DROP INDEX IF EXISTS idx_message_participants_thread_requester;
