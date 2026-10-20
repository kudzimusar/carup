import { tradeReference } from '@shared/communication/tradeThreadReference';

export interface CommunicationContextRow {
  label: string;
  value: string;
}

// A raw identifier means nothing to the person reading the conversation (OC-NATIVE-FINAL-02-R1 P2-A).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

export function communicationTitleCase(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function communicationChannelLabel(value: unknown): string | null {
  const raw = text(value)?.toLowerCase();
  if (!raw) return null;
  if (raw.includes('whatsapp')) return 'WhatsApp';
  if (raw.includes('telegram')) return 'Telegram';
  if (raw.includes('email')) return 'Email';
  if (raw.includes('push')) return 'Push';
  if (raw.includes('in_app') || raw.includes('web_chat') || raw.includes('mobile')) return 'CarUp';
  return communicationTitleCase(raw);
}

/**
 * A trade thread is named by the reference the web Inbox uses ("Sourcing request RFQ-87B14D63"), and a
 * marketplace enquiry as "Marketplace conversation" — never by its internal subject type.
 */
export function communicationThreadTitle(thread: any): string {
  const trade = tradeReference(thread || {});
  if (trade) return trade;
  if (thread?.business_workflow === 'marketplace' || thread?.thread_type === 'marketplace_inquiry') {
    return 'Marketplace conversation';
  }
  const workflow = communicationTitleCase(thread?.business_workflow || thread?.thread_type);
  const subject = communicationTitleCase(thread?.subject_type);
  return subject || workflow || 'CarUp conversation';
}

export function communicationThreadContext(thread: any): CommunicationContextRow[] {
  const rows: CommunicationContextRow[] = [];
  const listingId = text(thread?.marketplace_listing_id);
  const workflow = communicationTitleCase(thread?.business_workflow || thread?.thread_type);
  const participantRole = communicationTitleCase(thread?.participant_role);
  const channel = communicationChannelLabel(thread?.primary_channel);

  // A VIN is how people know a car; an internal listing or subject id is not shown at all.
  if (listingId && !UUID.test(listingId)) rows.push({ label: 'Listing', value: listingId });
  if (workflow) rows.push({ label: 'Journey', value: workflow });
  if (participantRole) rows.push({ label: 'Your role', value: participantRole });
  if (channel) rows.push({ label: 'Channel', value: channel });
  return rows;
}

export function communicationParticipantContext(participants: any[] = []): CommunicationContextRow[] {
  return participants
    .filter((participant) => participant && !participant.is_self)
    .map((participant) => {
      const name = text(participant.display_name);
      const role = communicationTitleCase(participant.stakeholder_role);
      if (!name && !role) return null;
      return {
        label: role || 'Participant',
        value: name || role || 'Participant',
      };
    })
    .filter((row): row is CommunicationContextRow => Boolean(row));
}

/**
 * OC-NATIVE-FINAL-02-R1 P2-A — a failed send is explained in plain words. The raw error
 * ("Communication API returned HTTP 500") was shown to the person before.
 */
export function communicationSendFailureMessage(error: unknown): string {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  const status = typeof statusCode === 'number' ? statusCode : null;
  if (status === 401) return 'Message not sent. Your session has ended; sign in again, then send it.';
  if (status === 403) return 'Message not sent. Try again, or sign in again if this keeps happening.';
  if (status === null) return 'Message not sent. Check your connection and try again.';
  return 'Message not sent. CarUp could not accept it right now; please try again.';
}
