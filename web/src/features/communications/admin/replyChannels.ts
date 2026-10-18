// Which channels a Command Center reply can actually reach for ONE thread, and which it should
// default to (CC-REPLY-CHANNEL-01).
//
// The composer used to send `thread.primary_channel || 'in_app'`. A conversation that began in-app
// and continued on WhatsApp keeps primary_channel = in_app, so an agent answering the customer's
// WhatsApp message silently replied in-app instead. The reply channel is now derived from the
// thread's own evidence: the channel identities of its participants (usable consent only) plus
// in-app when the thread has a primary user — never from channels configured elsewhere. The server
// remains the final authority and refuses (422) a channel it cannot resolve to a recipient.
//
// CA-OWNER-02 (H4): the server now publishes that authority on the thread detail (`reply_channel`:
// the CUSTOMER's deliverable channels and its default). When present it leads — the composer offers
// exactly those channels and defaults to the server's choice; on a Marketplace thread that means
// in-app is never offered just because the SELLER is the primary user. An explicit agent choice
// still wins while it is deliverable. Without it (an older server) the local rule below applies. A
// requested channel the customer cannot be reached on is refused (409), never substituted.

export interface ReplyChannelIdentity {
  channel?: string | null
  consent_status?: string | null
}

export interface ReplyChannelMessage {
  direction?: string | null
  channel?: string | null
  created_at?: string | null
}

// Mirrors the server's UNUSABLE_CONSENT_STATUSES (adminCommunicationRoutes.js).
const UNUSABLE_CONSENT = new Set(['opted_out', 'revoked'])

const norm = (value?: string | null) => String(value ?? '').trim().toLowerCase()

export function deliverableReplyChannels({ thread, identities }: {
  thread?: { primary_user_id?: string | null } | null
  identities?: ReplyChannelIdentity[] | null
}): string[] {
  const channels: string[] = []
  for (const identity of identities || []) {
    const channel = norm(identity.channel)
    if (!channel || channel === 'in_app') continue
    if (UNUSABLE_CONSENT.has(norm(identity.consent_status))) continue
    if (!channels.includes(channel)) channels.push(channel)
  }
  // An in-app reply is addressed to the thread's primary user, so it exists only when there is one.
  if (thread?.primary_user_id) channels.push('in_app')
  return channels
}

/** The latest CUSTOMER inbound channel when deliverable, else the primary channel when deliverable. */
export function defaultReplyChannel({ channels, messages, primaryChannel }: {
  channels: string[]
  messages?: ReplyChannelMessage[] | null
  primaryChannel?: string | null
}): string | null {
  const inbound = (messages || [])
    .filter((m) => norm(m.direction) === 'inbound' && channels.includes(norm(m.channel)))
    .sort((a, b) => (Date.parse(a.created_at || '') || 0) - (Date.parse(b.created_at || '') || 0))
  const latest = inbound[inbound.length - 1]
  if (latest) return norm(latest.channel)
  const primary = norm(primaryChannel)
  if (primary && channels.includes(primary)) return primary
  return channels[0] ?? null
}

/** The server's reply-channel authority (GET /threads/:id → reply_channel). */
export interface ServerReplyChannel {
  default_channel?: string | null
  deliverable?: string[] | null
}

/** The channels the composer offers: the server's authority when published, else the local rule. */
export function composerReplyChannels({ authority, thread, identities }: {
  authority?: ServerReplyChannel | null
  thread?: { primary_user_id?: string | null } | null
  identities?: ReplyChannelIdentity[] | null
}): string[] {
  if (authority && Array.isArray(authority.deliverable)) {
    return [...new Set(authority.deliverable.map((channel) => norm(channel)).filter(Boolean))]
  }
  return deliverableReplyChannels({ thread, identities })
}

/**
 * An explicit agent choice wins while it is still deliverable; then the server's default (H4) when deliverable;
 * otherwise the locally derived default.
 */
export function resolveReplyChannel({ choice, channels, messages, primaryChannel, serverDefault }: {
  choice?: string | null
  channels: string[]
  messages?: ReplyChannelMessage[] | null
  primaryChannel?: string | null
  serverDefault?: string | null
}): string | null {
  const chosen = norm(choice)
  if (chosen && channels.includes(chosen)) return chosen
  const preferred = norm(serverDefault)
  if (preferred && channels.includes(preferred)) return preferred
  return defaultReplyChannel({ channels, messages, primaryChannel })
}
