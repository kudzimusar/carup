import sys

with open('backend/routes/referralRoutes.js', 'r') as f:
    content = f.read()

stub_start = content.find('\n\n  // --- GROUP 1: ROLES MVP ---\n')
stub_end_marker = '\n\n  return router;\n}\n\nexport default createReferralRouter();\n'
stub_end = content.rfind(stub_end_marker)

if stub_start == -1 or stub_end == -1:
    print(f"MARKERS NOT FOUND: stub_start={stub_start} stub_end={stub_end}")
    sys.exit(1)

new_block = r"""

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 1 — ROLES MVP
  // ═══════════════════════════════════════════════════════════════════

  // GET own role profiles
  router.get('/roles/me', authorizeRole(), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const { data, error } = await client
      .from('referral_role_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    res.json({ success: true, profiles: data || [] });
  }));

  // Ambassador: activate/update profile — also returns permanent code
  router.post('/roles/ambassador', authorizeRole(['owner', 'admin', 'dealer']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const { tier = 'starter', metadata = {} } = req.body;

    const { data: profile, error: profErr } = await client
      .from('referral_role_profiles')
      .upsert(
        { tenant_id: tenantId, user_id: userId, profile_type: 'ambassador', tier, metadata, status: 'active' },
        { onConflict: 'tenant_id,user_id,profile_type' }
      )
      .select().single();
    if (profErr) throw new Error(profErr.message);

    const code = await referralService.ensurePermanentMemberCode(userId, tenantId);

    await referralService.recordReferralEvent(
      { event_type: 'referral.role_activated', subject_type: 'ambassador', subject_id: userId },
      createActor(req, ACTOR_TYPES.USER)
    );
    res.json({ success: true, profile, permanent_code: code });
  }));

  // Receiver: register payer→receiver link
  router.post('/roles/receiver', authorizeRole(['owner', 'admin', 'customer', 'dealer']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const {
      receiver_user_id, receiver_name, receiver_phone, receiver_location,
      reference, subject_type, subject_id,
    } = req.body;

    const { data: link, error } = await client
      .from('referral_receiver_links')
      .insert({
        tenant_id: tenantId,
        payer_user_id: userId,
        receiver_user_id: receiver_user_id || null,
        receiver_name: receiver_name || null,
        receiver_phone: receiver_phone || null,
        receiver_location: receiver_location || null,
        reference: reference || null,
        subject_type: subject_type || null,
        subject_id: subject_id || null,
      })
      .select().single();
    if (error) throw new Error(error.message);

    await client.from('referral_role_profiles').upsert(
      { tenant_id: tenantId, user_id: userId, profile_type: 'receiver', status: 'active', metadata: { reference } },
      { onConflict: 'tenant_id,user_id,profile_type' }
    );
    await referralService.recordReferralEvent(
      { event_type: 'referral.role_activated', subject_type: 'receiver', subject_id: userId },
      createActor(req, ACTOR_TYPES.USER)
    );
    res.status(201).json({ success: true, link });
  }));

  // Receiver: confirm handover
  router.patch('/roles/receiver/:linkId/handover', authorizeRole(['owner', 'customer', 'dealer']), asyncHandler(async (req, res) => {
    const tenantId = req.userContext.tenantId || 'platform';
    const { handover_status, note } = req.body;
    if (!['confirmed', 'disputed'].includes(handover_status)) {
      throw new ValidationError('handover_status must be confirmed or disputed');
    }
    const { data, error } = await client
      .from('referral_receiver_links')
      .update({ handover_status, metadata: { note } })
      .eq('id', req.params.linkId)
      .eq('tenant_id', tenantId)
      .select().single();
    if (error) throw new Error(error.message);
    await referralService.recordReferralEvent(
      { event_type: 'referral.handover_' + handover_status, subject_type: 'receiver_link', subject_id: req.params.linkId },
      createActor(req, ACTOR_TYPES.USER)
    );
    res.json({ success: true, link: data });
  }));

  // Mechanic/supplier: upsert profile + parts-request trade event
  router.post('/roles/mechanic', authorizeRole(['mechanic', 'admin', 'owner']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const {
      customer_name, vehicle_make, vehicle_model, vehicle_year, vin,
      part_number, description, image_url, referral_code, metadata = {},
    } = req.body;

    await client.from('referral_role_profiles').upsert(
      { tenant_id: tenantId, user_id: userId, profile_type: 'mechanic_supplier', status: 'active', metadata },
      { onConflict: 'tenant_id,user_id,profile_type' }
    );
    const { data: tradeEvent, error } = await client
      .from('referral_trade_events')
      .insert({
        tenant_id: tenantId,
        actor_user_id: userId,
        event_kind: 'parts_request',
        referral_code: referral_code || null,
        metadata: { customer_name, vehicle_make, vehicle_model, vehicle_year, vin, part_number, description, image_url },
      })
      .select().single();
    if (error) throw new Error(error.message);

    await referralService.recordReferralEvent(
      { event_type: 'referral.role_activated', subject_type: 'mechanic', subject_id: userId },
      createActor(req, ACTOR_TYPES.USER)
    );
    res.status(201).json({ success: true, trade_event: tradeEvent });
  }));

  // Agent/depot: register assisted lead (cannot approve own reward)
  router.post('/roles/agent', authorizeRole(['agent', 'admin', 'owner']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const { scan_context, reference, referral_code, metadata = {} } = req.body;
    const VALID_CONTEXTS = ['agent', 'depot', 'invoice', 'booking', 'pickup'];
    if (!VALID_CONTEXTS.includes(scan_context)) {
      throw new ValidationError('scan_context must be one of: ' + VALID_CONTEXTS.join(', '));
    }
    await client.from('referral_role_profiles').upsert(
      { tenant_id: tenantId, user_id: userId, profile_type: 'agent_depot', status: 'active', metadata: { scan_context } },
      { onConflict: 'tenant_id,user_id,profile_type' }
    );
    const { data: tradeEvent, error } = await client
      .from('referral_trade_events')
      .insert({
        tenant_id: tenantId,
        actor_user_id: userId,
        event_kind: 'buyer_inquiry',
        referral_code: referral_code || null,
        metadata: { scan_context, reference, ...metadata },
      })
      .select().single();
    if (error) throw new Error(error.message);

    await referralService.recordReferralEvent(
      { event_type: 'referral.assisted_lead_registered', subject_type: 'agent', subject_id: userId },
      createActor(req, ACTOR_TYPES.USER)
    );
    res.status(201).json({ success: true, trade_event: tradeEvent });
  }));

  // Agent: list own assisted leads
  router.get('/roles/agent/leads', authorizeRole(['agent', 'admin', 'owner']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const { data, error } = await client
      .from('referral_trade_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('actor_user_id', userId)
      .eq('event_kind', 'buyer_inquiry')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ success: true, leads: data || [] });
  }));

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 2 — TRADE JOURNEYS MVP
  // ═══════════════════════════════════════════════════════════════════

  // Buyer: capture referral code on inquiry
  router.post('/trade/buyer', authorizeRole(['customer', 'owner', 'dealer']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const { referral_code, listing_id, source = 'marketplace_inquiry', metadata = {} } = req.body;

    let validation = null;
    if (referral_code) {
      validation = await referralService.validateReferralCode({ code: referral_code });
    }
    const { data: event, error } = await client
      .from('referral_trade_events')
      .insert({
        tenant_id: tenantId,
        actor_user_id: userId,
        event_kind: 'buyer_inquiry',
        referral_code: referral_code || null,
        metadata: { listing_id, source, validation_valid: validation?.valid || false, ...metadata },
      })
      .select().single();
    if (error) throw new Error(error.message);

    await referralService.recordReferralEvent(
      { event_type: 'referral.buyer_inquiry', subject_type: 'trade_event', subject_id: event.id, code_id: validation?.code?.id || null },
      createActor(req, ACTOR_TYPES.USER)
    );
    res.status(201).json({ success: true, event, validation });
  }));

  // Seller: listing referral link + permanent code
  router.post('/trade/seller', authorizeRole(['owner', 'dealer']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const { listing_id, milestone, metadata = {} } = req.body;

    const code = await referralService.ensurePermanentMemberCode(userId, tenantId);
    const { data: event, error } = await client
      .from('referral_trade_events')
      .insert({
        tenant_id: tenantId,
        actor_user_id: userId,
        event_kind: 'seller_listing',
        referral_code: code.code,
        milestone: milestone || 'listed',
        metadata: { listing_id, ...metadata },
      })
      .select().single();
    if (error) throw new Error(error.message);

    await referralService.recordReferralEvent(
      { event_type: 'referral.seller_listing', subject_type: 'trade_event', subject_id: event.id, code_id: code.id },
      createActor(req, ACTOR_TYPES.USER)
    );
    res.status(201).json({ success: true, event, permanent_code: code });
  }));

  // Parts request: full vehicle + part details
  router.post('/trade/parts', authorizeRole(['mechanic', 'customer', 'owner', 'dealer']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const {
      vehicle_make, vehicle_model, vehicle_year, vin,
      part_number, description, image_url, document_url,
      payer_user_id, receiver_user_id, location,
      referral_code, metadata = {},
    } = req.body;

    if (!vehicle_make || !vehicle_model) {
      throw new ValidationError('vehicle_make and vehicle_model are required.');
    }
    const { data: event, error } = await client
      .from('referral_trade_events')
      .insert({
        tenant_id: tenantId,
        actor_user_id: userId,
        event_kind: 'parts_request',
        referral_code: referral_code || null,
        status: 'open',
        metadata: { vehicle_make, vehicle_model, vehicle_year, vin, part_number, description, image_url, document_url, payer_user_id, receiver_user_id, location, ...metadata },
      })
      .select().single();
    if (error) throw new Error(error.message);

    await referralService.recordReferralEvent(
      { event_type: 'referral.parts_requested', subject_type: 'trade_event', subject_id: event.id },
      createActor(req, ACTOR_TYPES.USER)
    );
    res.status(201).json({ success: true, event });
  }));

  // Update trade event status (parts/import milestones)
  router.patch('/trade/:eventId/status', authorizeRole(['admin', 'owner', 'dealer', 'mechanic']), asyncHandler(async (req, res) => {
    const tenantId = req.userContext.tenantId || 'platform';
    const { status, milestone, note } = req.body;
    const ALLOWED = ['open', 'quoted', 'deposit_paid', 'confirmed', 'delivered', 'cancelled', 'refunded'];
    if (!ALLOWED.includes(status)) {
      throw new ValidationError('status must be one of: ' + ALLOWED.join(', '));
    }
    const { data, error } = await client
      .from('referral_trade_events')
      .update({ status, milestone: milestone || null, metadata: { note } })
      .eq('id', req.params.eventId)
      .eq('tenant_id', tenantId)
      .select().single();
    if (error) throw new Error(error.message);

    await referralService.recordReferralEvent(
      { event_type: 'referral.trade_status_updated', subject_type: 'trade_event', subject_id: req.params.eventId, metadata: { status, milestone } },
      createActor(req, ACTOR_TYPES.ADMIN)
    );
    res.json({ success: true, event: data });
  }));

  // Vehicle import milestones
  router.post('/trade/import', authorizeRole(['admin', 'owner', 'dealer']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const IMPORT_MILESTONES = ['quote', 'deposit', 'inspection', 'purchase', 'shipment', 'documents', 'customs_handover', 'delivered'];
    const { milestone, referral_code, metadata = {} } = req.body;
    if (!IMPORT_MILESTONES.includes(milestone)) {
      throw new ValidationError('milestone must be one of: ' + IMPORT_MILESTONES.join(', '));
    }
    // quote alone must not create a payable reward state
    const eventStatus = milestone === 'quote' ? 'quoted' : 'open';
    const { data: event, error } = await client
      .from('referral_trade_events')
      .insert({
        tenant_id: tenantId,
        actor_user_id: userId,
        event_kind: 'import_milestone',
        referral_code: referral_code || null,
        milestone,
        status: eventStatus,
        metadata,
      })
      .select().single();
    if (error) throw new Error(error.message);

    await referralService.recordReferralEvent(
      { event_type: 'referral.import_milestone', subject_type: 'trade_event', subject_id: event.id, metadata: { milestone } },
      createActor(req, ACTOR_TYPES.ADMIN)
    );
    res.status(201).json({ success: true, event });
  }));

  // Container public booking (requires no auth for public; validates capacity)
  router.post('/trade/container', asyncHandler(async (req, res) => {
    const tenantId = req.userContext?.tenantId || 'platform';
    const userId = req.userContext?.id || 'anonymous';
    const {
      origin, destination, departure_date, capacity_requested,
      goods_description, referral_code, payer_details, receiver_details,
      waitlist_consent = false, campaign_id, metadata = {},
    } = req.body;

    if (!origin || !destination || !departure_date) {
      throw new ValidationError('origin, destination, and departure_date are required.');
    }
    if (!capacity_requested || Number(capacity_requested) <= 0) {
      throw new ValidationError('capacity_requested must be greater than 0.');
    }

    // Basic capacity check against existing confirmed bookings for this campaign
    if (campaign_id) {
      const { data: existing } = await client
        .from('referral_trade_events')
        .select('metadata')
        .eq('event_kind', 'container_booking')
        .eq('tenant_id', tenantId)
        .in('status', ['open', 'confirmed', 'deposit_paid']);
      const usedCapacity = (existing || [])
        .filter(b => b.metadata?.campaign_id === campaign_id)
        .reduce((sum, b) => sum + Number(b.metadata?.capacity_requested || 0), 0);
      if (usedCapacity + Number(capacity_requested) > 100 && !waitlist_consent) {
        throw new ValidationError('Container capacity exceeded. Set waitlist_consent=true to join the waitlist.');
      }
    }

    const { data: event, error } = await client
      .from('referral_trade_events')
      .insert({
        tenant_id: tenantId,
        actor_user_id: userId,
        event_kind: 'container_booking',
        referral_code: referral_code || null,
        campaign_id: campaign_id || null,
        status: 'open',
        metadata: { origin, destination, departure_date, capacity_requested, goods_description, payer_details, receiver_details, waitlist_consent, campaign_id, ...metadata },
      })
      .select().single();
    if (error) throw new Error(error.message);

    await referralService.recordReferralEvent(
      { event_type: 'referral.container_booking', subject_type: 'trade_event', subject_id: event.id, campaign_id: campaign_id || null },
      createActor(req, ACTOR_TYPES.USER)
    );
    res.status(201).json({ success: true, event });
  }));

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 3 — OPERATIONS MVP
  // ═══════════════════════════════════════════════════════════════════

  // Reward operations: transition wallet transaction (admin only)
  const REWARD_OP_TRANSITIONS = ['eligible', 'approved', 'payable', 'paid_or_applied', 'held', 'rejected'];
  router.post('/rewards/operate', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const actorId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const { transaction_id, new_status, reason } = req.body;

    if (!transaction_id) throw new ValidationError('transaction_id is required.');
    if (!REWARD_OP_TRANSITIONS.includes(new_status)) {
      throw new ValidationError('new_status must be one of: ' + REWARD_OP_TRANSITIONS.join(', '));
    }
    if (!reason || reason.trim().length < 3) {
      throw new ValidationError('reason is required (minimum 3 characters).');
    }
    if (['approved', 'payable', 'paid_or_applied'].includes(new_status) && req.userContext.role !== 'admin') {
      throw new ForbiddenError('Only admin can approve or mark rewards paid.');
    }

    // Get current tx for audit
    const { data: tx, error: txErr } = await client
      .from('referral_wallet_transactions')
      .select('*').eq('id', transaction_id).single();
    if (txErr || !tx) throw new Error('Wallet transaction not found.');

    const updated = await referralService.transitionWalletTransaction(
      transaction_id, new_status, createActor(req, ACTOR_TYPES.ADMIN)
    );

    // Persist reward operation log
    await client.from('referral_reward_operations').insert({
      tenant_id: tenantId,
      wallet_transaction_id: transaction_id,
      previous_status: tx.status,
      new_status,
      actor_user_id: actorId,
      reason: reason.trim(),
    });

    res.json({ success: true, transaction: updated });
  }));

  // CSV payout export from real stored transactions
  router.get('/rewards/export', authorizeRole(ADMIN_ROLES), asyncHandler(async (req, res) => {
    const tenantId = req.userContext.tenantId || 'platform';
    const { status = 'payable', campaign_id } = req.query;

    let query = client
      .from('referral_wallet_transactions')
      .select('id, wallet_id, amount, currency, status, source_event_type, reviewed_by, reviewed_at, created_at')
      .eq('status', status);
    if (campaign_id) query = query.eq('campaign_id', campaign_id);

    const { data: txns, error } = await query;
    if (error) throw new Error(error.message);

    const header = 'id,wallet_id,amount,currency,status,source_event_type,reviewed_by,reviewed_at,created_at';
    const rows = (txns || []).map(t =>
      [t.id, t.wallet_id, t.amount, t.currency, t.status, t.source_event_type || '', t.reviewed_by || '', t.reviewed_at || '', t.created_at].join(',')
    );
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename="referral_payout_${status}_${Date.now()}.csv"`);
    res.send([header, ...rows].join('\n'));
  }));

  // Fraud: compute real signals from available data
  router.post('/fraud/check', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const tenantId = req.userContext.tenantId || 'platform';
    const { user_id, referral_code, context = {} } = req.body;
    if (!user_id) throw new ValidationError('user_id is required for fraud check.');

    const signals = [];
    let riskScore = 0;

    // Signal 1: self-referral
    if (referral_code) {
      const { data: code } = await client
        .from('referral_codes').select('owner_user_id').eq('code', referral_code).maybeSingle();
      if (code && code.owner_user_id === user_id) { signals.push('SELF_REFERRAL'); riskScore += 30; }
    }

    // Signal 2: excessive velocity — more than 10 trade events in last 24h
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const { count: recentCount } = await client
      .from('referral_trade_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('actor_user_id', user_id).gte('created_at', since24h);
    if (recentCount > 10) { signals.push('EXCESSIVE_VELOCITY'); riskScore += 20; }

    // Signal 3: repeated cancellations/refunds (3 or more)
    const { count: cancelCount } = await client
      .from('referral_trade_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('actor_user_id', user_id).in('status', ['cancelled', 'refunded']);
    if (cancelCount >= 3) { signals.push('REPEATED_CANCELLATIONS'); riskScore += 15; }

    // Signal 4: repeated same receiver (more than 3 times)
    if (context.receiver_user_id) {
      const { count: receiverCount } = await client
        .from('referral_receiver_links')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('payer_user_id', user_id).eq('receiver_user_id', context.receiver_user_id);
      if (receiverCount > 3) { signals.push('REPEATED_RECEIVER'); riskScore += 10; }
    }

    const riskLevel = riskScore >= 30 ? 'HIGH' : riskScore >= 15 ? 'MEDIUM' : 'LOW';
    const reviewRequired = riskLevel !== 'LOW';

    await referralService.recordReferralEvent(
      { event_type: 'referral.fraud_check', subject_type: 'user', subject_id: user_id, metadata: { signals, riskScore, riskLevel } },
      createActor(req, ACTOR_TYPES.ADMIN)
    );

    res.json({ success: true, user_id, risk_level: riskLevel, risk_score: riskScore, signals, review_required: reviewRequired });
  }));

  // Consent/channel preferences — upsert per user and channel
  router.post('/preferences', authorizeRole(['owner', 'dealer', 'mechanic', 'customer', 'agent']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const { channel, opted_in, language = 'en', message_types = [], opt_in_source } = req.body;
    const VALID_CHANNELS = ['whatsapp', 'telegram', 'email', 'sms', 'social'];
    if (!VALID_CHANNELS.includes(channel)) {
      throw new ValidationError('channel must be one of: ' + VALID_CHANNELS.join(', '));
    }
    if (!['en', 'sn', 'nd'].includes(language)) {
      throw new ValidationError('language must be en, sn, or nd');
    }
    const { data, error } = await client
      .from('referral_channel_preferences')
      .upsert(
        {
          tenant_id: tenantId, user_id: userId, channel,
          opted_in: Boolean(opted_in),
          opted_in_at: opted_in ? new Date().toISOString() : null,
          opted_out_at: !opted_in ? new Date().toISOString() : null,
          language, message_types, opt_in_source: opt_in_source || null,
        },
        { onConflict: 'tenant_id,user_id,channel' }
      ).select().single();
    if (error) throw new Error(error.message);

    await referralService.recordReferralEvent(
      { event_type: 'referral.preference_updated', subject_type: 'user', subject_id: userId, metadata: { channel, opted_in, language } },
      createActor(req, ACTOR_TYPES.USER)
    );
    res.json({ success: true, preference: data });
  }));

  router.get('/preferences', authorizeRole(['owner', 'dealer', 'mechanic', 'customer', 'agent']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const { data, error } = await client
      .from('referral_channel_preferences')
      .select('*').eq('tenant_id', tenantId).eq('user_id', userId);
    if (error) throw new Error(error.message);
    res.json({ success: true, preferences: data || [] });
  }));

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 4 — GROWTH AND MOBILE MVP
  // ═══════════════════════════════════════════════════════════════════

  // Analytics — computed from real event tables
  router.get('/growth/analytics', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const tenantId = req.userContext.tenantId || 'platform';

    const [journeyRes, touchRes, tradeRes, txRes, fraudRes] = await Promise.all([
      client.from('referral_attribution_journeys').select('id, status, claimed_at').eq('tenant_id', tenantId),
      client.from('referral_attribution_touches').select('id, channel').eq('tenant_id', tenantId),
      client.from('referral_trade_events').select('id, event_kind, status').eq('tenant_id', tenantId),
      client.from('referral_wallet_transactions').select('amount, status').eq('tenant_id', tenantId),
      client.from('referral_events').select('id').eq('tenant_id', tenantId).eq('event_type', 'referral.fraud_check'),
    ]);

    const journeys = journeyRes.data || [];
    const touches = touchRes.data || [];
    const trades = tradeRes.data || [];
    const txns = txRes.data || [];
    const fraudChecks = fraudRes.data || [];

    const leads = journeys.length;
    const qualified_leads = journeys.filter(j => j.claimed_at).length;
    const conversions = journeys.filter(j => j.claimed_at).length;
    const conversion_rate = leads > 0 ? ((conversions / leads) * 100).toFixed(1) + '%' : '0%';

    const pending_reward_cost = txns
      .filter(t => ['pending', 'eligible'].includes(t.status))
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const paid_reward_cost = txns
      .filter(t => ['paid_or_applied', 'payable', 'approved'].includes(t.status))
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    const channel_performance = touches.reduce((acc, t) => {
      acc[t.channel] = (acc[t.channel] || 0) + 1; return acc;
    }, {});

    res.json({
      success: true,
      analytics: {
        visits: touches.length,
        leads,
        qualified_leads,
        conversions,
        conversion_rate,
        pending_reward_cost,
        paid_reward_cost,
        local_market_events: trades.filter(t => ['buyer_inquiry', 'seller_listing', 'parts_request'].includes(t.event_kind)).length,
        import_events: trades.filter(t => t.event_kind === 'import_milestone').length,
        container_bookings: trades.filter(t => t.event_kind === 'container_booking').length,
        channel_performance,
        fraud_checks: fraudChecks.length,
      },
    });
  }));

  // Multilingual marketing drafts (human review required before publish)
  router.get('/growth/marketing/drafts', authorizeRole(OPERATOR_ROLES), asyncHandler(async (req, res) => {
    const { language = 'en' } = req.query;
    const DRAFTS = {
      en: {
        campaign_message: 'Refer a friend to CarUp and earn rewards on every verified trade.',
        listing_referral: 'Share your CarUp listing and earn when it sells.',
        parts_follow_up: 'Your parts request has been received. Track it on CarUp.',
        container_campaign: 'Book container space on CarUp. Limited slots available.',
        proof_story: '[Human to complete: verified customer story]',
      },
      sn: {
        campaign_message: 'Rumirira shamwari yako kuCarUp ugowana mibayiro pakutengesa kwose kwakabvumidzwa.',
        listing_referral: 'Govera kurongerwa kwako kuCarUp ugowane kana kwatengwa.',
        parts_follow_up: 'Chikumbiro chako chezvidimbu chapiwa. Chiteveredze paCarUp.',
        container_campaign: 'Buka nzvimbo yecontainer paCarUp. Nzvimbo dzishoma dziripo.',
        proof_story: '[Muntu wekugadzira: nyaya yomuchengeti wechokwadi]',
      },
      nd: {
        campaign_message: 'Thumela umngane kuCarUp futhi uphumelele amaphoyinti kuzo zonke izintengiselwano.',
        listing_referral: 'Yabelana ukubhalisa kwakho kuCarUp futhi uphumelele uma kwithengiswa.',
        parts_follow_up: 'Isicelo sakho sezingxenye samukelwe. Silandele kuCarUp.',
        container_campaign: 'Bhuka indawo yecontainer kuCarUp. Izindawo ezinqatshwa ziyatholakala.',
        proof_story: '[Umuntu ouzokwenza: indaba yamakhasimende eqiniso]',
      },
    };
    const draft = DRAFTS[language] || DRAFTS.en;
    res.json({ success: true, language, draft, review_required: true, _note: 'All drafts require explicit human approval before publication.' });
  }));

  // Mobile receiver status
  router.get('/mobile/receiver/status', authorizeRole(['customer', 'owner', 'dealer']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';
    const { data: links, error } = await client
      .from('referral_receiver_links')
      .select('*')
      .eq('tenant_id', tenantId)
      .or(`payer_user_id.eq.${userId},receiver_user_id.eq.${userId}`)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ success: true, links: links || [] });
  }));

  // Mobile ambassador summary
  router.get('/mobile/ambassador/summary', authorizeRole(['owner', 'dealer', 'admin']), asyncHandler(async (req, res) => {
    const userId = req.userContext.id;
    const tenantId = req.userContext.tenantId || 'platform';

    const [profileRes, codeRes, journeyRes, txRes] = await Promise.all([
      client.from('referral_role_profiles').select('*').eq('tenant_id', tenantId).eq('user_id', userId).eq('profile_type', 'ambassador').maybeSingle(),
      client.from('referral_codes').select('*').eq('tenant_id', tenantId).eq('owner_user_id', userId).eq('is_permanent', true).maybeSingle(),
      client.from('referral_attribution_journeys').select('id, status, claimed_at').eq('tenant_id', tenantId).eq('reward_owner_user_id', userId),
      client.from('referral_wallet_transactions').select('amount, status').eq('tenant_id', tenantId),
    ]);

    const journeys = journeyRes.data || [];
    const txns = txRes.data || [];

    res.json({
      success: true,
      ambassador: {
        profile: profileRes.data || null,
        permanent_code: codeRes.data || null,
        leads: journeys.length,
        conversions: journeys.filter(j => j.claimed_at).length,
        pending_rewards: txns.filter(t => ['pending', 'eligible'].includes(t.status)).reduce((s, t) => s + Number(t.amount || 0), 0),
        approved_rewards: txns.filter(t => ['approved', 'payable', 'paid_or_applied'].includes(t.status)).reduce((s, t) => s + Number(t.amount || 0), 0),
        tier: profileRes.data?.tier || 'starter',
      },
    });
  }));

"""

new_content = content[:stub_start] + new_block + stub_end_marker
with open('backend/routes/referralRoutes.js', 'w') as f:
    f.write(new_content)

print(f"Done. New file length: {len(new_content)} chars")
