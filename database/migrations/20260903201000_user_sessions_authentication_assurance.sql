-- +migrate Up
-- O2-X3: authentication assurance columns on user_sessions.
--
-- A session must be able to answer, SERVER-SIDE, "how was this person authenticated, and when
-- did they last step up" — nothing here is ever trusted from the client. Additive and
-- idempotent, matching the 20260617120000 contract-alignment style (this table's timestamp
-- columns are TEXT; the new ones follow the existing convention rather than introducing a
-- second convention into the same table).
--
--   auth_method     how the session was established ('password'; future authenticators land
--                   here — never asserted by the caller)
--   step_up_at      when the holder last re-proved themselves on THIS session (text ISO)
--   step_up_method  how ('password_reauth' today; 'webauthn' only once a real authenticator
--                   exists — there is deliberately no code path that can set it before then)

ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS auth_method text;
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS step_up_at text;
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS step_up_method text;

-- +migrate Down
ALTER TABLE public.user_sessions DROP COLUMN IF EXISTS step_up_method;
ALTER TABLE public.user_sessions DROP COLUMN IF EXISTS step_up_at;
ALTER TABLE public.user_sessions DROP COLUMN IF EXISTS auth_method;
