export const REGISTRATION_ACCOUNT_KINDS = Object.freeze(['individual', 'business']);
export const REGISTRATION_MARKET_RELATIONSHIPS = Object.freeze(['zimbabwe_local', 'diaspora', 'international']);
export const REGISTRATION_INTENDED_USES = Object.freeze(['buy', 'sell', 'buy_sell', 'professional_services']);
export const REGISTRATION_BUSINESS_TYPES = Object.freeze([
  'dealer',
  'exporter',
  'importer',
  'garage',
  'mechanic',
  'parts_seller',
  'insurer',
  'lender',
  // Non-authorizing business identity for freight/container co-loading organisers (Trade OS D2).
  // Grants no platform role; container authority comes from governed tenant membership.
  'logistics_provider',
  'other',
]);

const asText = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const inVocabulary = (value, vocabulary) => vocabulary.includes(value);

export function normalizeRegistrationProfile(raw, { fallbackLocation = '' } = {}) {
  if (raw === undefined || raw === null) {
    return {
      ok: true,
      profile: null,
      userLocation: asText(fallbackLocation, 160) || null,
    };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'registration_profile must be an object' };
  }

  const accountKind = asText(raw.account_kind, 32);
  const marketRelationship = asText(raw.market_relationship, 32);
  const countryOfResidence = asText(raw.country_of_residence, 100);
  const city = asText(raw.city || fallbackLocation, 100);
  const province = asText(raw.province, 100) || null;
  const intendedUse = asText(raw.intended_use, 40);
  const organizationName = asText(raw.organization_name, 160) || null;
  const businessType = asText(raw.business_type, 48) || null;

  if (!inVocabulary(accountKind, REGISTRATION_ACCOUNT_KINDS)) {
    return { ok: false, error: 'Choose whether this is an individual or business account.' };
  }
  if (!inVocabulary(marketRelationship, REGISTRATION_MARKET_RELATIONSHIPS)) {
    return { ok: false, error: 'Choose your relationship to the Zimbabwe market.' };
  }
  if (!countryOfResidence) return { ok: false, error: 'Country of residence is required.' };
  if (!city) return { ok: false, error: 'City or location is required.' };
  if (!inVocabulary(intendedUse, REGISTRATION_INTENDED_USES)) {
    return { ok: false, error: 'Choose how you intend to use CarUp.' };
  }

  if (accountKind === 'business') {
    if (!organizationName) return { ok: false, error: 'Business or organisation name is required.' };
    if (!businessType || !inVocabulary(businessType, REGISTRATION_BUSINESS_TYPES)) {
      return { ok: false, error: 'Choose the type of automotive business.' };
    }
  }

  if (raw.terms_acknowledged !== true || raw.privacy_acknowledged !== true) {
    return { ok: false, error: 'Terms of Service and Privacy Policy acknowledgement are required.' };
  }

  const profile = {
    account_kind: accountKind,
    market_relationship: marketRelationship,
    country_of_residence: countryOfResidence,
    city,
    province,
    intended_use: intendedUse,
    organization_name: accountKind === 'business' ? organizationName : null,
    business_type: accountKind === 'business' ? businessType : null,
    onboarding_status: accountKind === 'business' ? 'requested' : 'not_required',
    marketing_consent: raw.marketing_consent === true,
    terms_acknowledged_at: new Date().toISOString(),
    privacy_acknowledged_at: new Date().toISOString(),
  };

  return { ok: true, profile, userLocation: city };
}
