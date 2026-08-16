-- +migrate Up
-- Communications 2.0 participant authorization hardening.
-- Implementation target: docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md,
-- sections 8, 25, 29, 31 and 32.
--
-- The first additive core migration accepted a user-id argument in its SECURITY
-- DEFINER membership helper so policies could pass auth.uid(). Although the policies
-- passed the correct current user, granting that two-argument helper to authenticated
-- callers exposed a boolean membership-enumeration surface. Replace it with a
-- one-argument helper that derives the caller exclusively from auth.uid().

CREATE OR REPLACE FUNCTION public.communication_is_thread_participant(p_thread_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.message_participants mp
    WHERE mp.thread_id = p_thread_id
      AND mp.user_id = (select auth.uid())::text
      AND mp.left_at IS NULL
      AND COALESCE((mp.permissions ->> 'read')::boolean, TRUE) = TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.communication_is_thread_participant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_is_thread_participant(UUID) TO authenticated;

DROP POLICY IF EXISTS "message_threads_participant_read" ON message_threads;
CREATE POLICY "message_threads_participant_read" ON message_threads
  FOR SELECT TO authenticated
  USING (
    primary_user_id = (select auth.uid())::text
    OR public.communication_is_thread_participant(id)
  );

DROP POLICY IF EXISTS "messages_participant_read" ON messages;
CREATE POLICY "messages_participant_read" ON messages
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id));

DROP POLICY IF EXISTS "message_participants_thread_read" ON message_participants;
CREATE POLICY "message_participants_thread_read" ON message_participants
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id));

DROP POLICY IF EXISTS "conversation_channel_bindings_participant_read" ON conversation_channel_bindings;
CREATE POLICY "conversation_channel_bindings_participant_read" ON conversation_channel_bindings
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id));

DROP POLICY IF EXISTS "message_parts_participant_read" ON message_parts;
CREATE POLICY "message_parts_participant_read" ON message_parts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM messages m
    WHERE m.id = message_parts.message_id
      AND public.communication_is_thread_participant(m.thread_id)
  ));

DROP POLICY IF EXISTS "conversation_events_participant_read" ON conversation_events;
CREATE POLICY "conversation_events_participant_read" ON conversation_events
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id));

DROP POLICY IF EXISTS "message_derivations_participant_read" ON message_derivations;
CREATE POLICY "message_derivations_participant_read" ON message_derivations
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id));

REVOKE ALL ON FUNCTION public.communication_is_thread_participant(UUID, TEXT) FROM authenticated;
DROP FUNCTION IF EXISTS public.communication_is_thread_participant(UUID, TEXT);

-- +migrate Down
-- Restore the exact compatibility helper shape from the preceding core migration.
CREATE OR REPLACE FUNCTION public.communication_is_thread_participant(p_thread_id UUID, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.message_participants mp
    WHERE mp.thread_id = p_thread_id
      AND mp.user_id = p_user_id
      AND mp.left_at IS NULL
      AND COALESCE((mp.permissions ->> 'read')::boolean, TRUE) = TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.communication_is_thread_participant(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_is_thread_participant(UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS "message_threads_participant_read" ON message_threads;
CREATE POLICY "message_threads_participant_read" ON message_threads
  FOR SELECT TO authenticated
  USING (
    primary_user_id = (select auth.uid())::text
    OR public.communication_is_thread_participant(id, (select auth.uid())::text)
  );

DROP POLICY IF EXISTS "messages_participant_read" ON messages;
CREATE POLICY "messages_participant_read" ON messages
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id, (select auth.uid())::text));

DROP POLICY IF EXISTS "message_participants_thread_read" ON message_participants;
CREATE POLICY "message_participants_thread_read" ON message_participants
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id, (select auth.uid())::text));

DROP POLICY IF EXISTS "conversation_channel_bindings_participant_read" ON conversation_channel_bindings;
CREATE POLICY "conversation_channel_bindings_participant_read" ON conversation_channel_bindings
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id, (select auth.uid())::text));

DROP POLICY IF EXISTS "message_parts_participant_read" ON message_parts;
CREATE POLICY "message_parts_participant_read" ON message_parts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM messages m
    WHERE m.id = message_parts.message_id
      AND public.communication_is_thread_participant(m.thread_id, (select auth.uid())::text)
  ));

DROP POLICY IF EXISTS "conversation_events_participant_read" ON conversation_events;
CREATE POLICY "conversation_events_participant_read" ON conversation_events
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id, (select auth.uid())::text));

DROP POLICY IF EXISTS "message_derivations_participant_read" ON message_derivations;
CREATE POLICY "message_derivations_participant_read" ON message_derivations
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id, (select auth.uid())::text));

DROP FUNCTION IF EXISTS public.communication_is_thread_participant(UUID);
