const request = require('supertest');
const { app, supabase } = require('../server');
const crypto = require('crypto');

describe('Wave A: Attribution and Race Conditions (Staging Proof)', () => {
  let testTenant = 'platform';
  let referrerId = 'u_' + crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  let referralCode = 'STAGE_REF_' + Date.now();
  let codeId;

  beforeAll(async () => {
    // 1. Create a real active staging code for a test referrer
    await supabase.from('users').insert({
      id: referrerId,
      name: 'Referrer User',
      email: `referrer_${Date.now()}@staging-test.com`,
      role: 'owner',
      join_date: new Date().toISOString()
    });

    const codeRes = await supabase.from('referral_codes').insert({
      tenant_id: testTenant,
      owner_user_id: referrerId,
      code: referralCode,
      code_type: 'MEMBER',
      is_permanent: true,
      status: 'ACTIVE'
    }).select().single();
    
    codeId = codeRes.data.id;
  });

  it('valid /r/:code -> full attribution journey', async () => {
    // 2. Open /r/<active-code>
    const res = await request(app).get(`/r/${referralCode}`).redirects(0);
    
    // 4. Confirm redirect to /register
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/register?ref=${referralCode}`);

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const journeyCookie = cookies.find(c => c.startsWith('referral_journey_token='));
    expect(journeyCookie).toBeDefined();
    
    // Parse cookie to get token
    const cookieVal = journeyCookie.split(';')[0].split('=')[1];
    const decoded = JSON.parse(decodeURIComponent(cookieVal));
    expect(decoded.token).toBeDefined();

    // Confirm anonymous journey stored
    const { data: journey } = await supabase.from('referral_attribution_journeys')
      .select('*')
      .eq('anonymous_journey_id', decoded.token)
      .single();
    expect(journey).toBeDefined();
    expect(journey.reward_owner_user_id).toBe(referrerId);

    // 3. Confirm first touch stored
    const { data: touches } = await supabase.from('referral_attribution_touches')
      .select('*')
      .eq('journey_id', journey.id);
    expect(touches.length).toBe(1);
    expect(touches[0].touch_kind).toBe('first');
    
    // 5. Register a test user (confirm journey claim)
    const newEmail = `newuser_${Date.now()}@staging-test.com`;
    const regRes = await request(app)
      .post('/api/auth/register')
      .set('Cookie', [`referral_journey_token=${encodeURIComponent(JSON.stringify(decoded))}`])
      .send({
        name: 'New User',
        email: newEmail,
        password: 'password123'
      });
      
    expect(regRes.status).toBe(200);
    const newUserId = regRes.body.user.id;
    
    // Confirm cookie is rotated/cleared
    const regCookies = regRes.headers['set-cookie'];
    const clearedCookie = regCookies && regCookies.find(c => c.startsWith('referral_journey_token=;'));
    expect(clearedCookie).toBeDefined();

    // 6. Confirm journey claim
    const { data: claimedJourney } = await supabase.from('referral_attribution_journeys')
      .select('*')
      .eq('id', journey.id)
      .single();
    expect(claimedJourney.user_id).toBe(newUserId);
    expect(claimedJourney.status).toBe('active');
    expect(claimedJourney.claimed_at).not.toBeNull();
    // 7. Confirm original reward_owner_code_id
    expect(claimedJourney.reward_owner_code_id).toBe(codeId);
    
    // 8. Confirm exactly one permanent member code for the new user
    const { data: newCodes } = await supabase.from('referral_codes')
      .select('*')
      .eq('owner_user_id', newUserId)
      .eq('is_permanent', true);
    expect(newCodes.length).toBe(1);

    // Repeat bootstrap creates no duplicate
    await request(app)
      .post('/api/auth/register')
      .set('Cookie', [`referral_journey_token=${encodeURIComponent(JSON.stringify(decoded))}`])
      .send({
        name: 'New User 2',
        email: `newuser2_${Date.now()}@staging-test.com`,
        password: 'password123'
      });
      
    const { data: newCodesCheck } = await supabase.from('referral_codes')
      .select('*')
      .eq('owner_user_id', newUserId)
      .eq('is_permanent', true);
    expect(newCodesCheck.length).toBe(1);

    // Self-referral rejected
    const myCode = newCodesCheck[0].code;
    const selfRes = await request(app).get(`/r/${myCode}`).redirects(0);
    const selfCookies = selfRes.headers['set-cookie'];
    const selfJourneyCookie = selfCookies.find(c => c.startsWith('referral_journey_token='));
    const selfCookieVal = selfJourneyCookie.split(';')[0].split('=')[1];
    const selfDecoded = JSON.parse(decodeURIComponent(selfCookieVal));
    
    // Attempt claim via service
    const { ReferralEngineService } = require('../services/referral/referralEngineService');
    const service = new ReferralEngineService({ client: supabase });
    await service.bindAttributionJourney(selfDecoded.token, newUserId, testTenant);
    
    const { data: selfJourney } = await supabase.from('referral_attribution_journeys')
      .select('*')
      .eq('anonymous_journey_id', selfDecoded.token)
      .single();
    expect(selfJourney.status).toBe('abandoned');
  });
});
