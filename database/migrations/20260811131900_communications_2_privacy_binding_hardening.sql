-- +migrate Up
-- Communications 2.0 privacy + conversation-binding hardening.
-- Implementation target: docs/communications/CARUP_COMMUNICATIONS_2_CANONICAL_PLAN.md,
-- sections 7.2, 7.5, 8, 11, 25, 26 and 31.
--
-- Invariants enforced here:
--  * an external participant can never read an internal-note message through RLS;
--  * a channel binding cannot point at a participant from a different conversation;
--  * only active template registry rows are directly readable by authenticated users.

-- The composite FK below prevents a malformed/compromised server write from binding
-- one conversation to a participant that belongs to another conversation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_participants_id_thread
  ON message_participants (id, thread_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversation_channel_bindings_participant_thread_fkey'
      AND conrelid = 'public.conversation_channel_bindings'::regclass
  ) THEN
    ALTER TABLE conversation_channel_bindings
      ADD CONSTRAINT conversation_channel_bindings_participant_thread_fkey
      FOREIGN KEY (participant_id, thread_id)
      REFERENCES message_participants(id, thread_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Section 8 is explicit: internal notes are invisible to external participants.
-- Keep that invariant in the database policy as well as in the Express projection.
DROP POLICY IF EXISTS "messages_participant_read" ON messages;
CREATE POLICY "messages_participant_read" ON messages
  FOR SELECT TO authenticated
  USING (
    direction <> 'internal'
    AND public.communication_is_thread_participant(thread_id)
  );

-- Draft/retired template registry metadata is an operational concern; ordinary
-- authenticated clients only need the active governed registry. Version rows already
-- require approval_status='approved'.
DROP POLICY IF EXISTS "communication_templates_authenticated_read" ON communication_templates;
CREATE POLICY "communication_templates_authenticated_read" ON communication_templates
  FOR SELECT TO authenticated
  USING (status = 'active');

-- +migrate Down
DROP POLICY IF EXISTS "communication_templates_authenticated_read" ON communication_templates;
CREATE POLICY "communication_templates_authenticated_read" ON communication_templates
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "messages_participant_read" ON messages;
CREATE POLICY "messages_participant_read" ON messages
  FOR SELECT TO authenticated
  USING (public.communication_is_thread_participant(thread_id));

ALTER TABLE conversation_channel_bindings
  DROP CONSTRAINT IF EXISTS conversation_channel_bindings_participant_thread_fkey;

DROP INDEX IF EXISTS idx_message_participants_id_thread;
