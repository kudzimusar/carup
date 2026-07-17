export const COMMUNICATION_CHANNELS = [
  'whatsapp',
  'telegram',
  'email',
  'sms',
  'instagram',
  'facebook',
  'web_chat',
  'mobile_chat',
  'in_app',
  'push',
] as const;

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export type ThreadStatus =
  | 'open'
  | 'awaiting_ai'
  | 'awaiting_human'
  | 'assigned'
  | 'awaiting_user'
  | 'escalated'
  | 'resolved'
  | 'closed'
  | 'spam';

export type ThreadPriority = 'low' | 'normal' | 'high' | 'urgent';
export type AiMode = 'enabled' | 'draft_only' | 'disabled' | 'human_only';

export interface CanonicalAttachment {
  type: string;
  url?: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface CanonicalInboundMessage {
  provider: string;
  channel: CommunicationChannel;
  providerEventId?: string;
  providerMessageId?: string;
  externalSenderId: string;
  externalConversationId?: string;
  text?: string;
  attachments?: CanonicalAttachment[];
  timestamp: string;
  replyToProviderMessageId?: string;
  referralCode?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelRecipient {
  userId?: string;
  identityId?: string;
  externalId?: string;
  address?: string;
  displayName?: string;
}

export interface RenderedMessageContent {
  subject?: string;
  body: string;
  text?: string;
  html?: string;
  data?: Record<string, unknown>;
}

export interface ChannelSendRequest {
  notificationId: string;
  messageId: string;
  recipient: ChannelRecipient;
  content: RenderedMessageContent;
  idempotencyKey: string;
  correlationId: string;
}

export interface ChannelSendResult {
  accepted: boolean;
  providerRequestId?: string;
  providerMessageId?: string;
  providerStatus?: string;
  retryable?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface CommunicationPreference {
  user_id: string;
  tenant_id?: string | null;
  transactional_enabled: boolean;
  marketing_enabled: boolean;
  whatsapp_enabled: boolean;
  telegram_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  in_app_enabled: boolean;
  preferred_channel?: CommunicationChannel | null;
  fallback_channels: CommunicationChannel[];
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  timezone?: string | null;
  language?: string | null;
}

export interface MessageThreadSummary {
  id: string;
  thread_type: string;
  subject_type?: string | null;
  subject_id?: string | null;
  status: ThreadStatus;
  priority: ThreadPriority;
  ai_mode: AiMode;
  primary_channel?: CommunicationChannel | null;
  assigned_admin_id?: string | null;
  assigned_team?: string | null;
  last_message_at?: string | null;
  sla_due_at?: string | null;
  metadata?: Record<string, unknown>;
}

