export interface CommunicationContextRow {
  label: string;
  value: string;
}

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

export function communicationThreadTitle(thread: any): string {
  const workflow = communicationTitleCase(thread?.business_workflow || thread?.thread_type);
  const subject = communicationTitleCase(thread?.subject_type);
  return subject || workflow || 'CarUp conversation';
}

export function communicationThreadContext(thread: any): CommunicationContextRow[] {
  const rows: CommunicationContextRow[] = [];
  const listingId = text(thread?.marketplace_listing_id);
  const subjectId = text(thread?.subject_id);
  const subjectType = communicationTitleCase(thread?.subject_type);
  const workflow = communicationTitleCase(thread?.business_workflow || thread?.thread_type);
  const participantRole = communicationTitleCase(thread?.participant_role);
  const channel = communicationChannelLabel(thread?.primary_channel);

  if (listingId) rows.push({ label: 'Listing', value: listingId });
  if (!listingId && subjectId) rows.push({ label: subjectType || 'Subject', value: subjectId });
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
