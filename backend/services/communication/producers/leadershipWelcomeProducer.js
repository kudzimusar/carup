import { referenceEntry } from '../emailExperience/emailTemplateRegistry.js';
import { LEADERSHIP_REPLY_TO } from '../emailExperience/referenceLeadershipWelcome.js';

/**
 * The durable post-verification work item.
 *
 * Named here rather than inline so the emitter (the auth route), the subscriber list, the
 * orchestrator branch and the database dedupe rule cannot drift onto four different spellings of
 * the same event.
 */
export const EMAIL_VERIFIED_EVENT = 'user.email.verified';

/**
 * R1 — the canonical Leadership Welcome producer.
 *
 * MOVED here from `authRecoveryRoutes.js`, not rewritten: the payload it builds is identical. What
 * changed is WHO calls it and WHEN.
 *
 * THE DEFECT this closes. The route used to call the producer inline, immediately after consuming
 * the verification token, and swallow any failure:
 *
 *     await queueLeadershipWelcome(userId).catch((e) => console.error(...));
 *
 * The verification token is single-use and already consumed by that point, so the operation cannot
 * be replayed. A transient failure anywhere in that call — the user lookup, the template render, the
 * thread resolve, the notification insert — meant that account permanently never received its
 * welcome, with nothing anywhere recording that it was owed one. This was the only production call
 * site, so there was no second path to recover it.
 *
 * The verification route now writes a durable `user.email.verified` outbox event instead, and this
 * producer runs from the event worker. The durability boundary moves from "the whole notification
 * pipeline succeeded on the first try" to "one row was inserted", and everything after it is
 * retried by the outbox until it succeeds or visibly dead-letters.
 *
 * Idempotency is unchanged and still lives in the database: `dedupeParts` produce a durable
 * `dedupe_key`, and `queueNotification` returns the existing row rather than inserting a second. A
 * replayed event, a concurrent worker and a reconciliation pass therefore all converge on exactly
 * one welcome — the guarantee survives a restart, which an in-process guard would not.
 */
export async function queueLeadershipWelcome({ userId, repository, notificationService } = {}) {
  if (!userId || !repository || !notificationService) return null;

  const user = await repository.findOne('users', { id: userId });
  // No address means nothing to send to. This is a genuine absence, not a fault: returning null
  // lets the event be marked processed rather than retried forever against a user who has none.
  if (!user?.email) return null;

  const entry = referenceEntry('leadership_welcome');
  return notificationService.queueNotification({
    recipientUserId: user.id,
    notificationType: 'leadership_welcome',
    channel: 'email',
    templateKey: entry.templateKey,
    language: 'en',
    priority: 'normal',
    transactional: true,
    classification: entry.classification,
    fallbackChannels: [],
    variables: {},
    // One welcome per account, for the lifetime of the account.
    dedupeParts: ['leadership_welcome', user.id],
    payload: {
      email: user.email,
      classification: entry.classification,
      reference_template: 'leadership_welcome',
      // The canonical name resolver renders this in title case, or degrades to a
      // non-personalised greeting. It never fabricates a first name.
      recipient_name: user.name || null,
      reply_to: LEADERSHIP_REPLY_TO,
    },
  });
}

export default queueLeadershipWelcome;
