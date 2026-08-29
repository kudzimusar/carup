import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRegistrationProfile,
  REGISTRATION_BUSINESS_TYPES,
} from '../services/auth/registrationProfileService.js';

test('individual Diaspora profile is context, not a platform role', () => {
  const result = normalizeRegistrationProfile({
    account_kind: 'individual',
    market_relationship: 'diaspora',
    country_of_residence: 'Japan',
    city: 'Tokyo',
    intended_use: 'buy_sell',
    terms_acknowledged: true,
    privacy_acknowledged: true,
    marketing_consent: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.profile.account_kind, 'individual');
  assert.equal(result.profile.market_relationship, 'diaspora');
  assert.equal(result.profile.onboarding_status, 'not_required');
  assert.equal(result.profile.business_type, null);
  assert.equal(result.userLocation, 'Tokyo');
  assert.equal('role' in result.profile, false);
});

test('business Dealer/Exporter intent requests governed onboarding and grants no role', () => {
  for (const businessType of ['dealer', 'exporter']) {
    const result = normalizeRegistrationProfile({
      account_kind: 'business',
      market_relationship: 'international',
      country_of_residence: 'Japan',
      city: 'Yokohama',
      intended_use: 'professional_services',
      organization_name: 'UAT Motors',
      business_type: businessType,
      terms_acknowledged: true,
      privacy_acknowledged: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.profile.business_type, businessType);
    assert.equal(result.profile.onboarding_status, 'requested');
    assert.equal('role' in result.profile, false);
  }
});

test('business registration requires organisation and governed business type', () => {
  const missingOrg = normalizeRegistrationProfile({
    account_kind: 'business',
    market_relationship: 'zimbabwe_local',
    country_of_residence: 'Zimbabwe',
    city: 'Harare',
    intended_use: 'professional_services',
    business_type: 'dealer',
    terms_acknowledged: true,
    privacy_acknowledged: true,
  });
  assert.equal(missingOrg.ok, false);

  const inventedType = normalizeRegistrationProfile({
    account_kind: 'business',
    market_relationship: 'zimbabwe_local',
    country_of_residence: 'Zimbabwe',
    city: 'Harare',
    intended_use: 'professional_services',
    organization_name: 'UAT Motors',
    business_type: 'admin',
    terms_acknowledged: true,
    privacy_acknowledged: true,
  });
  assert.equal(inventedType.ok, false);
  assert.equal(REGISTRATION_BUSINESS_TYPES.includes('admin'), false);
});

test('terms and privacy are separately required while marketing remains optional', () => {
  const base = {
    account_kind: 'individual',
    market_relationship: 'zimbabwe_local',
    country_of_residence: 'Zimbabwe',
    city: 'Harare',
    intended_use: 'sell',
  };
  assert.equal(normalizeRegistrationProfile({ ...base, terms_acknowledged: true, privacy_acknowledged: false }).ok, false);
  assert.equal(normalizeRegistrationProfile({ ...base, terms_acknowledged: false, privacy_acknowledged: true }).ok, false);
  const ok = normalizeRegistrationProfile({ ...base, terms_acknowledged: true, privacy_acknowledged: true }).profile;
  assert.equal(ok.marketing_consent, false);
});


test('registration profile migration is backend-writable and public-client closed', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../../database/migrations/20260829123000_user_registration_profiles.sql', import.meta.url), 'utf8');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON public\.user_registration_profiles FROM anon, authenticated/i);
  assert.match(sql, /GRANT ALL ON public\.user_registration_profiles TO service_role/i);
});
