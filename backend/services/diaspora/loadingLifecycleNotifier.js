/**
 * Trade OS T10.4 — telling a participant what happened to their cargo at the container.
 *
 * The CONSUMER half only, like `warehouseIntakeNotifier`, `shipmentExceptionNotifier` and the rest.
 * It runs after the authoritative load line has committed and been audited:
 *
 *   authorized loading action → load item row → audit → outbox event → governed template → notice
 *
 * **A notification never loads anything.** Nothing here writes a manifest line, and a delivery
 * failure can no more unload a container than a successful one can fill it.
 *
 * The event that matters most is the second one. A customer whose cargo WAS loaded will find out
 * eventually; a customer whose cargo was **left behind** is the person standing at the other end
 * expecting goods that are not coming, and the reason is the only thing they can act on. Sending
 * only the happy path would be the more comfortable choice and the wrong one.
 *
 * The payloads carry no other participant's cargo, no operator identity, no sailing total and no
 * departure claim: LOADED is not DEPARTED, and T11 owns that.
 */
import { emitDomainEvent } from '../eventBus/eventBusService.js';

export const LOADING_EVENTS = Object.freeze({
  LOADED: 'diaspora.loading.cargo_loaded',
  LEFT_BEHIND: 'diaspora.loading.cargo_left_behind',
});

/**
 * Why cargo did not travel, in the customer's terms rather than the warehouse's.
 *
 * `NOT_PRESENTED` is the one worth wording carefully: the operational fact is that nobody brought it
 * to the container, and telling a customer "not presented" invites them to think they did something
 * wrong. It says what happened instead.
 */
const LEFT_BEHIND_SENTENCE = Object.freeze({
  NO_SPACE: 'There was not enough room left in the container.',
  DID_NOT_FIT: 'It would not physically fit in the container.',
  CONDITION_ISSUE: 'There was a problem with the condition of the cargo.',
  DOCUMENTS_OUTSTANDING: 'Paperwork for this cargo was still outstanding.',
  NOT_PRESENTED: 'The cargo was not brought to the container in time for loading.',
  PARTICIPANT_REQUEST: 'It was held back at your request.',
  OPERATIONAL_EXCEPTION: 'It was held back for an operational reason.',
});

async function forEachOwner(recipients, send) {
  // buyer_id and created_by are usually the same person; telling them twice about one container is
  // wrong in exactly the way a duplicated arrival notice is.
  const unique = [...new Set((recipients || []).filter(Boolean).map(String))];
  const sent = [];
  for (const recipientUserId of unique) {
    try {
      // Best-effort: the manifest line is already durable and audited, and an outbox failure must
      // never roll it back or mask it.
      sent.push(await send(recipientUserId));
    } catch (err) {
      console.warn('[loading-lifecycle] outbox emit failed:', err.message);
    }
  }
  return sent;
}

/** Your cargo is in the container. Not: your cargo has left. */
export async function notifyCargoLoaded({ loadItem, load, recipients, emitEvent = emitDomainEvent }) {
  if (!loadItem?.id || loadItem.outcome !== 'LOADED') return [];
  // Keep the event type a LITERAL at the call site: `communication-event-coverage` scans for
  // `emit…Event(null, '<type>', …)`, and a subscription whose emitter it cannot see is one that
  // looks alive and is dead. T7 and T9 both learned this the same way.
  return forEachOwner(recipients, (recipientUserId) => emitEvent(null, 'diaspora.loading.cargo_loaded', {
    recipientUserId,
    loadItemId: loadItem.id,
    loadId: load?.id || loadItem.load_id,
    reference: load?.reference || null,
    subjectType: loadItem.subject_type,
    subjectId: loadItem.subject_id,
    headline: 'Your cargo has been loaded into the container.',
    loadedVolumeCbm: loadItem.loaded_volume_cbm === null || loadItem.loaded_volume_cbm === undefined
      ? null : Number(loadItem.loaded_volume_cbm),
    // Said in the payload so no template can turn loading into sailing.
    note: 'Loaded means your cargo is inside the container. It does not mean the container has sailed.',
    subject_type: 'diaspora_container_load',
  }, load?.tenant_id ?? null));
}

/**
 * Your cargo did NOT travel, and this is why.
 *
 * High priority, because the person at the other end is waiting for goods that are not coming. It
 * makes no promise about what happens next — no refund, no re-booking, no next sailing — because
 * none of those is T10's to make.
 */
export async function notifyCargoLeftBehind({ loadItem, load, recipients, emitEvent = emitDomainEvent }) {
  if (!loadItem?.id || loadItem.outcome !== 'LEFT_BEHIND') return [];
  const reason = String(loadItem.left_behind_reason || '');
  return forEachOwner(recipients, (recipientUserId) => emitEvent(null, 'diaspora.loading.cargo_left_behind', {
    recipientUserId,
    loadItemId: loadItem.id,
    loadId: load?.id || loadItem.load_id,
    reference: load?.reference || null,
    subjectType: loadItem.subject_type,
    subjectId: loadItem.subject_id,
    headline: 'Your cargo was not loaded into this container.',
    reasonCode: reason || null,
    // The bounded reason in plain words. Never invented — an unrecognised code yields no sentence
    // rather than a guess at one.
    reason: LEFT_BEHIND_SENTENCE[reason] || null,
    // T10 records that it did not travel. What happens next is somebody's decision, not a
    // consequence this notice may announce.
    next_step_promised: false,
    subject_type: 'diaspora_container_load',
  }, load?.tenant_id ?? null));
}
