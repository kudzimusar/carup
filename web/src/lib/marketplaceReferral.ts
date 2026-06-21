/**
 * Marketplace referral capture (web).
 *
 * Captures referral/campaign/UTM attribution from the URL and persists it for the session so that a
 * later inquiry/quote action can attach it. The backend referral engine owns rewards; the frontend
 * only forwards attribution. Never blocks rendering.
 */

const STORAGE_KEY = 'carup_referral_attribution';

export interface ReferralAttribution {
  referral_code?: string;
  campaign_code?: string;
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  captured_at?: string;
}

function safeSession(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Read attribution params from a query string (or window.location.search), persist them when present,
 * and return the merged stored attribution. Supported params: ref, referral_code, campaign,
 * campaign_code, source, utm_source, utm_medium, utm_campaign.
 */
export function captureReferralFromUrl(search?: string): ReferralAttribution {
  const store = safeSession();
  const qs = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const params = new URLSearchParams(qs || '');

  const incoming: ReferralAttribution = {};
  const ref = params.get('ref') || params.get('referral_code');
  const campaign = params.get('campaign') || params.get('campaign_code') || params.get('utm_campaign') || undefined;
  if (ref) incoming.referral_code = ref;
  if (campaign) incoming.campaign_code = campaign;
  if (params.get('source')) incoming.source = params.get('source') || undefined;
  if (params.get('utm_source')) incoming.utm_source = params.get('utm_source') || undefined;
  if (params.get('utm_medium')) incoming.utm_medium = params.get('utm_medium') || undefined;
  if (params.get('utm_campaign')) incoming.utm_campaign = params.get('utm_campaign') || undefined;

  const existing = getStoredAttribution();
  if (Object.keys(incoming).length === 0) return existing;

  const merged: ReferralAttribution = { ...existing, ...incoming, captured_at: new Date().toISOString() };
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* ignore quota/availability errors */
  }
  return merged;
}

export function getStoredAttribution(): ReferralAttribution {
  const store = safeSession();
  try {
    const raw = store?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReferralAttribution) : {};
  } catch {
    return {};
  }
}

/** Fields to merge into an inquiry payload (referral_code / campaign_code / source_channel). */
export function inquiryAttributionFields(sourceChannel: 'web' | 'mobile' = 'web'): {
  referral_code?: string;
  campaign_code?: string;
  source_channel: 'web' | 'mobile';
} {
  const a = getStoredAttribution();
  return {
    referral_code: a.referral_code,
    campaign_code: a.campaign_code,
    source_channel: sourceChannel,
  };
}
