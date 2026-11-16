-- =============================================================
-- SERVICE NETWORK FOUNDATION 1.0 — O5: 'service_case' communication thread type
-- =============================================================
-- O5 subscribes four governed service-case transitions to canonical Communications. Their
-- notification policy opens a thread of type 'service_case', but `message_threads.thread_type`
-- carries a CHECK constraint listing the allowed types, and 'service_case' was not among them.
--
-- The consequence is worth stating precisely, because it is the failure mode this whole
-- reconciliation exists to prevent: the subscription would have looked complete in JavaScript, the
-- event would have been emitted and consumed, and the thread INSERT would then have been rejected
-- by the database — so the customer would never have been told. Nothing in the application would
-- have reported an absence. `backend/tests/communication-event-coverage.test.js` caught it, which
-- is why that gate parses this constraint rather than trusting the policy table.
--
-- A service case is genuinely its own subject. Reusing 'support' or 'general' would put governed
-- service conversations in a bucket that means something else, so the vocabulary is extended.
--
-- FORWARD-ONLY and ADDITIVE: the existing twelve types are reproduced unchanged and 'service_case'
-- is appended. No row can violate the new constraint that satisfied the old one.
-- +migrate Up
ALTER TABLE public.message_threads
  DROP CONSTRAINT IF EXISTS message_threads_thread_type_check;

ALTER TABLE public.message_threads
  ADD CONSTRAINT message_threads_thread_type_check
  CHECK (thread_type IN (
    'support','marketplace_inquiry','referral','escrow','finance','import','container',
    'trust_safety','feedback','complaint','account','general',
    -- Service Network O5:
    'service_case'
  ));

-- +migrate Down
-- Reverts to the original twelve. Any 'service_case' thread must be reclassified first; this is
-- deliberately left to fail loudly rather than silently rewriting governed conversation history.
ALTER TABLE public.message_threads
  DROP CONSTRAINT IF EXISTS message_threads_thread_type_check;

ALTER TABLE public.message_threads
  ADD CONSTRAINT message_threads_thread_type_check
  CHECK (thread_type IN (
    'support','marketplace_inquiry','referral','escrow','finance','import','container',
    'trust_safety','feedback','complaint','account','general'
  ));
