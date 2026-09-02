-- +migrate Up
-- Auth/security deliveries are account activity, not General reply-capable conversations.
DO $zr_auth_threads$
BEGIN
  IF to_regclass('public.message_threads') IS NOT NULL
     AND to_regclass('public.notification_queue') IS NOT NULL THEN
    UPDATE public.message_threads t
       SET thread_type = 'account', updated_at = now()
     WHERE t.thread_type = 'general'
       AND EXISTS (
         SELECT 1 FROM public.notification_queue n
          WHERE n.thread_id = t.id
            AND n.channel = 'email'
            AND n.template_key IN ('auth_email_verification_v1','auth_password_reset_v1','auth_password_changed_v1')
       );
  END IF;
END
$zr_auth_threads$;

-- +migrate Down
SELECT 1;
