import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';

// ✅ Supabase client (replaces SQLite database.js)
import { supabase } from './db/supabase.js';

// Import Middleware
import { authorizeRole, optionalAuth, isPrivateEvidenceFallbackAllowed } from './middleware/authMiddleware.js';
import { evaluateLoginCredentials, hashPassword } from './utils/passwordAuth.js';

// Import Services
// trustGraphService is the DEPRECATED 70-baseline engine. Only its non-score signal collection is
// used from here (see buildVehiclePassport); its score is never published, and
// `calculateVehicleTrustScore` — the writer that stamps vehicles.trust_score with no calculation
// version — is deliberately NOT imported, so this file cannot reach it.
import { getVehicleTimeline, runOdometerAudit, computeVehicleTrustScore } from './services/trustGraph/trustGraphService.js';
// The canonical trust authority (ADR-001, Issue #164 Phase 3): the ONE place any surface asks what
// CarUp's trust position on a VIN is. Every trust number this file publishes comes from here.
import {
  RECOMPUTE,
  TRUST_EVALUATION_STATES,
  getCanonicalTrust,
  getCanonicalTrustBatch,
  publicTrustViolations,
  toPublicTrust,
} from './services/trustDecision/canonicalTrustService.js';
import { verifyChain, addEvent } from './services/blockchain/blockchainService.js';
import { createEscrow, updateEscrowStatus } from './services/safepay/escrowService.js';
import { addRepairLog, getRepairHistory } from './services/partsentry/partsentryService.js';
import { runFraudAnalysis, runOcrParsing, runRiskScoring } from './services/ai/aiServiceBus.js';

// Import Group B & C Services
import { submitFinancingApplication } from './services/finance/financeService.js';
import { calculateInsuranceQuote, createInsurancePolicy } from './services/insurance/insuranceService.js';
import { calculateZimraDuty } from './services/import/importService.js';
import { reportVehicleStolen, checkStolenStatus } from './services/security/securityService.js';
import { calculateDealerReputation } from './services/reputation/reputationService.js';
import { getSmartRecommendations } from './services/recommendation/recommendationService.js';
import { reserveVehicle } from './services/reservation/reservationService.js';

// ✅ Phase 6: Event-Driven Architecture Imports
import { eventWorker } from './services/eventBus/eventWorker.js';
import { registerDomainListeners } from './services/eventBus/listeners.js';
import paymentRouter from './services/payment/paymentRouter.js';

// ✅ Phase 7: Object Storage & Media Router Imports
import mediaRouter from './services/storage/mediaRouter.js';
import documentIntelligenceRouter from './services/document-intelligence/documentIntelligenceRouter.js';
import { mergeEventsWithEvidence, normalizeEvidenceRecord } from './services/evidence/evidenceService.js';
import { logAuditEvent } from './services/auditLogger.js';

// Central Error Handling Imports
import errorHandler from './middleware/errorMiddleware.js';
import correlationMiddleware from './middleware/correlationMiddleware.js';
import telemetryMiddleware from './middleware/telemetryMiddleware.js';
import { metricsHub } from './services/metrics.js';
import { NotFoundError, ForbiddenError, UnauthorizedError } from './utils/errors.js';
import {
  securityHeadersMiddleware,
  rateLimiter,
  csrfMiddleware,
  generateCsrfToken,
  parseCookies
} from './middleware/securityMiddleware.js';
import { corsOptions } from './config/corsOptions.js';
import { buildSessionRow } from './services/auth/sessionRow.js';

// Centralized Routes Imports (Batch 1)
import leadsRouter from './routes/leadsRoutes.js';
import promotionsRouter from './routes/promotionsRoutes.js';
import workOrdersRouter from './routes/workOrdersRoutes.js';
import partsRouter from './routes/partsRoutes.js';
import claimsRouter from './routes/claimsRoutes.js';

// Centralized Routes Imports (Batch 2)
import adminRouter from './routes/adminRoutes.js';
import { edgeClientIpMiddleware } from './middleware/edgeClientIp.js';
import { authRecoveryRouter } from './routes/authRecoveryRoutes.js';
import { marketingUnsubscribeRouter } from './routes/marketingUnsubscribeRoutes.js';
import { resolveBuildProvenance } from './config/buildProvenance.js';
import vehiclesRouter from './routes/vehiclesRoutes.js';
import evidenceCatalogRouter from './routes/evidenceCatalogRoutes.js';
import ingestionRouter from './routes/ingestionRoutes.js';
import sourceVerificationRouter from './routes/sourceVerificationRoutes.js';
import trustDecisionRouter from './routes/trustDecisionRoutes.js';
import partnerApiRouter from './routes/partnerApiRoutes.js';
import partnerAdminRouter from './routes/partnerAdminRoutes.js';
import fraudRouter from './routes/fraudRoutes.js';
import dealerRouter from './routes/dealerRoutes.js';
import eligibilityRouter from './routes/eligibilityRoutes.js';
import escrowTrustRouter from './routes/escrowTrustRoutes.js';
import providerPlatformRouter from './routes/providerPlatformRoutes.js';
// Full Activation — provider capability workflows (government / insurer / lender / escrow / mobile cert)
import governmentActivationRouter from './routes/governmentActivationRoutes.js';
import insurerRouter from './routes/insurerRoutes.js';
import lenderRouter from './routes/lenderRoutes.js';
import escrowProviderRouter from './routes/escrowProviderRoutes.js';
import mobileCertificationRouter from './routes/mobileCertificationRoutes.js';
import intelligenceRouter from './routes/intelligenceRoutes.js';
import reportRouter from './routes/reportRoutes.js';
import governanceRouter from './routes/governanceRoutes.js';
import marketplaceRouter from './routes/marketplaceRoutes.js';
import marketplaceAdminRouter from './routes/marketplaceAdminRoutes.js';
import communicationRouter from './routes/communicationRoutes.js';
import adminCommunicationRouter from './routes/adminCommunicationRoutes.js';
import complianceRouter from './routes/complianceRoutes.js';
import financeRouter from './routes/financeRoutes.js';
import diasporaRouter from './routes/diasporaRoutes.js';
import trustFactRouter from './routes/trustFactRoutes.js';
import identityVerificationRouter from './routes/identityVerificationRoutes.js';
import featureGovernanceRouter from './routes/featureGovernanceRoutes.js';
import navigationAnalyticsRouter from './routes/navigationAnalyticsRoutes.js';
import identityVerificationAdminRouter from './routes/identityVerificationAdminRoutes.js';
import partsentryReviewRouter from './routes/partsentryReviewRoutes.js';
import garageDirectoryRouter from './routes/garageDirectoryRoutes.js';
import serviceCaseRouter from './routes/serviceCaseRoutes.js';
import serviceWorkOrderRouter from './routes/serviceWorkOrderRoutes.js';
import serviceRecordRouter from './routes/serviceRecordRoutes.js';
import { getOwnerServiceHistory } from './services/serviceNetwork/ownerServiceHistoryService.js';
import { normalizeVehicleStatus, publicVehicleStatusFilterValues, publiclyVisiblePublicationStatuses, isPublicVehicleStatus, isPubliclyVisiblePublication, PUBLIC_VEHICLE_COLUMNS } from './utils/vehicleStatus.js';
import { attestedValue, CLAIM_VISIBILITY, LISTING_CLAIM_COLUMNS, PUBLIC_VEHICLE_SELECT, projectVehicle, toListingClaims, toPublicEvidence, toPublicPlateHistory, toPublicTimelineEvent } from './utils/publicVehicleProjection.js';
// The canonical vehicle media contract (Issue #164 §10). Imported at MODULE scope and handed to
// buildVehiclePassport as a PARAMETER — never referenced as a free name inside that function, for
// the reason the function's own header gives: two harnesses execute its source against a fixed
// 11-name dependency list, and a twelfth free name is a ReferenceError there rather than a failure
// that says what changed.
// `isPublishableMediaUrl` is imported alongside the projector so the WRITE path gates on the SAME
// definition of publishable that the read path projects. A second copy of that rule living in the
// handler is how the two drift, and a URL the reader refuses forever is one the writer should never
// have accepted. See the listing-media block of POST /api/vehicles/add.
import { toVehicleMedia, isPublishableMediaUrl, toListingMediaBlock } from './utils/vehicleMediaProjection.js';
import {
  LOOKUP_KINDS,
  LOOKUP_DECISIONS,
  NON_ENUMERABLE_LOOKUP_RESPONSE,
  classifyLookupIdentifier,
  resolveLookupAccess,
  resolveSellerLookupOptIn,
  lookupColumnsForKind,
} from './utils/passportLookupPolicy.js';
import { buildVehicleListingCandidate, getListingEligibility } from './services/marketplace/marketplaceListingEligibility.js';
import { registerCommunicationListeners } from './services/communication/communicationEventListeners.js';
import { evaluateCompleteness } from './services/evidence/completenessEvaluator.js';
import { validateCommunicationConfiguration } from './services/communication/communicationConfigurationValidator.js';

dotenv.config();

// Environment Validation Guards on Startup
if (!process.env.SUPABASE_URL) {
  throw new Error('FATAL: SUPABASE_URL is missing in environment variables.');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('FATAL: SUPABASE_SERVICE_ROLE_KEY is missing in environment variables.');
}
if (
  process.env.OCR_MODE === 'strict' &&
  !process.env.GEMINI_API_KEY &&
  !process.env.GROQ_API_KEY
) {
  throw new Error(
    'FATAL: STRICT OCR MODE REQUIRES AT LEAST ONE REAL OCR PROVIDER (GEMINI_API_KEY or GROQ_API_KEY)'
  );
}

const startupCommunicationConfiguration = validateCommunicationConfiguration();
const startupCommunicationLog = {
  status: startupCommunicationConfiguration.status,
  explanations: startupCommunicationConfiguration.explanations,
  blockedProviders: startupCommunicationConfiguration.providers
    .filter((provider) => provider.status === 'BLOCKED')
    .map((provider) => provider.channel),
};
if (startupCommunicationConfiguration.status === 'BLOCKED') {
  console.error('❌ Communication configuration BLOCKED:', startupCommunicationLog);
} else if (startupCommunicationConfiguration.status === 'WARNING') {
  console.warn('⚠️ Communication configuration WARNING:', startupCommunicationLog);
} else {
  console.log('✅ Communication configuration READY');
}

const app = express();
const PORT = process.env.PORT || 5001;

app.options(/.*/, cors(corsOptions), (req, res) => res.sendStatus(204));
app.use(cors(corsOptions));
app.use(correlationMiddleware);
app.use(telemetryMiddleware);
app.use(securityHeadersMiddleware);
app.use(rateLimiter({ max: 100, windowMs: 60 * 1000, isSensitive: false }));

// Sensitive Route Throttling (auth, uploads, safepay creation, verification)
// Must run BEFORE any rate limiter so limits key on the real client, not a Cloudflare edge IP.
app.use(edgeClientIpMiddleware());
app.use('/api/auth/switch-role', rateLimiter({ max: 5, windowMs: 60 * 1000, isSensitive: true }));
app.use('/api/media/upload', rateLimiter({ max: 5, windowMs: 60 * 1000, isSensitive: true }));
app.use('/api/verification', rateLimiter({ max: 5, windowMs: 60 * 1000, isSensitive: true }));
app.use('/api/safepay/create', rateLimiter({ max: 5, windowMs: 60 * 1000, isSensitive: true }));

// Capture the exact raw request bytes for webhook paths so in-service HMAC signature
// verification checks the real payload the sender signed. The global parsers run before any
// route-level parser, so route-level `verify` callbacks never fire — this is the single place
// raw bytes are available. The '/webhook' substring covers the Full Activation provider webhooks
// (Phase 8 billing, SafeTrade payment) AND the communications-engine webhooks
// (/api/communications/webhooks/...); scoped so ordinary request bodies are not buffered as strings.
const captureWebhookRawBody = (req, _res, buf) => {
  const u = req.originalUrl || req.url || '';
  // The communications-engine pattern is covered by the substring but kept explicit — it is a
  // source-level contract asserted by communication-engine.test.js.
  if (u.includes('/webhook') || /^\/api\/communications\/webhooks\/[^/]+\/[^/]+(?:$|[/?#])/.test(u)) {
    req.rawBody = buf.toString('utf8');
  }
};
app.use(express.json({ limit: '15mb', verify: (req, _res, buf) => captureWebhookRawBody(req, _res, buf) }));
app.use(express.urlencoded({ limit: '15mb', extended: true, verify: (req, _res, buf) => captureWebhookRawBody(req, _res, buf) }));
app.use(csrfMiddleware);

// Signed CSRF token route
app.get('/api/security/csrf-token', (req, res) => {
  const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
  const currentUserId = req.headers['x-user-id'] || 'guest';
  const token = generateCsrfToken(currentUserId, sessionToken);
  res.cookie('csrf-token', token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 3600000 * 2,
    path: '/',
  });
  res.json({ csrfToken: token });
});

// Expose operational health and metrics endpoint
app.get('/api/health', async (req, res) => {
  let supabaseHealth = 'healthy';
  let outboxBacklog = 0;
  try {
    const { count, error } = await supabase
      .from('domain_events')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) {
      supabaseHealth = 'unhealthy';
    } else {
      outboxBacklog = count || 0;
    }
  } catch (e) {
    supabaseHealth = 'unhealthy';
  }

  const snapshot = metricsHub.getSnapshot();
  const communicationConfiguration = validateCommunicationConfiguration();

  res.json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    // Which source revision this instance was built from. Load-bearing for certification: CarUp
    // staging serves two runtimes (API and the cron sender) that have silently diverged before.
    build: resolveBuildProvenance(),
    supabase: {
      status: supabaseHealth,
      outboxBacklog
    },
    sentry: {
      enabled: !!process.env.SENTRY_DSN
    },
    ocrProviders: {
      gemini: !!process.env.GEMINI_API_KEY,
      groq: !!process.env.CARUP_KIMI_GROQ_API_KEY || !!process.env.GROQ_API_KEY,
      openrouter: !!process.env.OPENROUTER_API_KEY,
      moonshot: !!process.env.MOONSHOT_API_KEY
    },
    communications: {
      status: communicationConfiguration.status,
      ready: communicationConfiguration.ready,
      explanations: communicationConfiguration.explanations,
      providers: communicationConfiguration.providers.map((provider) => ({
        channel: provider.channel,
        provider: provider.provider,
        status: provider.status,
        available: provider.available,
        explanations: provider.explanations
      }))
    },
    metrics: snapshot
  });
});

// Mount payment gateway unified routes
app.use('/api/payments', paymentRouter);

// Mount media upload unified routes
app.use('/api/media', mediaRouter);

// Mount Trust & Identity verification routes
app.use('/api/verification', documentIntelligenceRouter);

// Mount centralized routes (Batch 1)
app.use(leadsRouter);
app.use(promotionsRouter);
app.use(workOrdersRouter);
app.use(partsRouter);
app.use(claimsRouter);

// Mount centralized routes (Batch 2)
app.use(authRecoveryRouter());
app.use(marketingUnsubscribeRouter());
app.use(adminRouter);
app.use(communicationRouter());
app.use(adminCommunicationRouter());
app.use(marketplaceRouter);
app.use(marketplaceAdminRouter);
app.use(vehiclesRouter);
app.use(evidenceCatalogRouter);
app.use(ingestionRouter);
app.use(sourceVerificationRouter);
app.use(trustDecisionRouter);
app.use(partnerApiRouter);
app.use(partnerAdminRouter);
app.use(fraudRouter);
app.use(dealerRouter);
app.use(eligibilityRouter);
app.use(escrowTrustRouter);
app.use(providerPlatformRouter);
// Full Activation — provider capability workflows (government / insurer / lender / escrow / mobile cert)
app.use(governmentActivationRouter);
app.use(insurerRouter);
app.use(lenderRouter);
app.use(escrowProviderRouter);
app.use(mobileCertificationRouter);
app.use(intelligenceRouter);
app.use(reportRouter);
app.use(governanceRouter);
app.use(complianceRouter);
app.use(financeRouter);
app.use(trustFactRouter);
app.use(identityVerificationRouter);
app.use(featureGovernanceRouter);
app.use(navigationAnalyticsRouter);
app.use(identityVerificationAdminRouter);
app.use(partsentryReviewRouter);
app.use(garageDirectoryRouter);
app.use(serviceCaseRouter);
app.use(serviceWorkOrderRouter);
app.use(serviceRecordRouter);

// Mount isolated Diaspora Trade bounded context
app.use('/api/diaspora', diasporaRouter);

// ✅ Verify Supabase connection on startup
const { data: connectionTest, error: connectionError } = await supabase.from('vehicles').select('vin').limit(1);
if (connectionError) {
  console.error('❌ Supabase connection failed:', connectionError.message);
  console.error('Please apply the schema at: database/migrations/supabase_schema.sql');
} else {
  console.log('✅ CarUp OS connected to Supabase');
  console.log(`✅ OCR provider initialized: ${process.env.OCR_PRIMARY_PROVIDER === 'gemini' ? 'Gemini' : 'None'}`);
  console.log(`✅ OCR fallback provider initialized: ${process.env.OCR_FALLBACK_PROVIDER === 'groq' ? 'Groq' : 'None'}`);
  console.log(`${process.env.OCR_MODE === 'strict' ? '✅ Strict OCR mode enabled' : '⚠️ Loose OCR mode enabled'}`);
  console.log(`${process.env.ALLOW_OCR_MOCK === 'false' ? '❌ Mock OCR disabled' : '⚠️ Mock OCR enabled'}`);
  
  // Start Event-Driven Outbox Background Worker and register listeners
  registerDomainListeners(eventWorker);
  registerCommunicationListeners(eventWorker);
  eventWorker.start(1000); // Concurrency-safe interval poller (1s)
}

// --- PILLAR 20: AUTH & STAKEHOLDER PORTAL SWITCHING ---
app.post('/api/auth/switch-role', authorizeRole(), async (req, res, next) => {
  const { userId, role, tenantId } = req.body;
  const auditBase = {
    req,
    source_route: '/api/auth/switch-role',
    actor_user_id: req.userContext?.id,
    actor_role: req.userContext?.role,
    actor_tenant_id: req.userContext?.tenantId,
    previous_value: {
      role: req.userContext?.role,
      tenantId: req.userContext?.tenantId || null
    },
    new_value: {
      role: role || null,
      tenantId: tenantId || null
    }
  };
  
  try {
    await logAuditEvent(supabase, {
      ...auditBase,
      event_type: 'ROLE_SWITCH_REQUESTED'
    });

    // 1. Requester can only switch their own user context
    if (userId !== req.userContext.id) {
      throw new ForbiddenError('Forbidden. You can only switch your own role.');
    }

    // 2. Validate role matches the system's approved role catalog:
    const approvedRoles = ['owner', 'dealer', 'mechanic', 'insurance', 'government', 'admin', 'bank'];
    if (!role || !approvedRoles.includes(role)) {
      throw new ForbiddenError(`Forbidden. Role '${role}' is not in the approved role catalog.`);
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (userError || !user) throw new NotFoundError('User record not found');
    
    // Fetch organization/tenant context if tenantId provided
    let verifiedTenantId = null;
    let verifiedTenantRole = null;
    if (tenantId) {
      const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('tenant_id, role')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .single();
        
      if (!tenantUser) {
        throw new ForbiddenError('Forbidden. You do not belong to this organization.');
      }
      verifiedTenantId = tenantUser.tenant_id;
      verifiedTenantRole = tenantUser.role;
    }

    const canAssumeRequestedRole = role === user.role || (verifiedTenantRole && role === verifiedTenantRole && role !== 'admin');
    if (!canAssumeRequestedRole) {
      throw new ForbiddenError(`Forbidden. Role '${role}' is not verified for this user context.`);
    }
    
    // Generate secure session
    const token = 'sk_live_' + crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    
    const { error: switchSessionError } = await supabase.from('user_sessions').insert(
      buildSessionRow({ userId, activeRole: role, token, expiresAt: expiresAt.toISOString(), req, tenantId: verifiedTenantId })
    );
    if (switchSessionError) {
      throw new Error('Could not establish a session for the switched role.');
    }

    await logAuditEvent(supabase, {
      ...auditBase,
      event_type: 'ROLE_SWITCH_GRANTED',
      actor_user_id: userId,
      actor_role: role,
      actor_tenant_id: verifiedTenantId
    });

    res.json({
      success: true,
      message: `Role switched to ${role} successfully (session established).`,
      token,
      user: { ...user, role, active_tenant_id: verifiedTenantId }
    });
  } catch (error) {
    await logAuditEvent(supabase, {
      ...auditBase,
      event_type: 'ROLE_SWITCH_DENIED',
      reason: error.message
    });
    next(error);
  }
});
// --- VEHICLE SINGLE FETCH ---
// Public per-VIN fetch: sanitized projection + the same visibility rules as the
// marketplace (a draft/quarantined VIN 404s instead of leaking its raw row).
app.get('/api/vehicles/:vin/details', async (req, res) => {
  const { vin } = req.params;
  try {
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select(`${PUBLIC_VEHICLE_SELECT}, tenant:tenants(name, type, status)`)
      .eq('vin', vin)
      .single();
    if (error) throw error;
    if (!isPublicVehicleStatus(vehicle.status) || !isPubliclyVisiblePublication(vehicle.publication_status)) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    // The public projection no longer fetches the stored trust_score (an unversioned cache): the
    // canonical projection is attached here instead, so this endpoint cannot be the one that still
    // hands a shopper the 84.
    const [projected] = await withCanonicalTrust([vehicle]);
    res.json(projected);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Publish a canonical trust record through the ONE public contract, guarded.
 *
 * `publicTrustViolations` is the shared checker the canonical service and its guard suite use, so
 * this route cannot drift from the contract it claims to serve. A shape that fails it is NOT
 * shipped half-published: the surface reports `unavailable` and says so, because a malformed trust
 * projection is a fault in us, never a finding about the vehicle.
 */
function publishCanonicalTrust(vin, record, context) {
  const shape = toPublicTrust(record);
  const violations = publicTrustViolations(shape);
  if (violations.length === 0) return shape;
  console.error(`Canonical trust contract violated in ${context} for ${vin}: ${violations.join(', ')}`);
  return toPublicTrust({
    vin: vin || '',
    evaluation_state: TRUST_EVALUATION_STATES.UNAVAILABLE,
    known_limitations: [
      'The canonical trust projection failed its own contract check, so no trust score is published for this vehicle.',
    ],
  });
}

/**
 * The canonical trust projection for a page of vehicles, keyed by VIN. ONE cache-only query, zero
 * recomputes, and an entry for EVERY requested VIN — so no branch below is left with a gap it might
 * fill from the row's own `trust_score` column.
 */
async function canonicalTrustForVins(vins) {
  const wanted = [...new Set((vins || []).filter(Boolean))];
  const out = new Map();
  if (!wanted.length) return out;
  const records = await getCanonicalTrustBatch(wanted, { client: supabase });
  for (const [vin, record] of records) out.set(vin, publishCanonicalTrust(vin, record, 'vehicle list'));
  return out;
}

/**
 * Replace the stored `trust_score` on every vehicle row leaving this file with the canonical
 * projection, and attach that projection as `trust`.
 *
 * THE RULE THIS ENCODES: a vehicle-ROW read publishes the canonical cache state (cache-only — a
 * page of rows must never trigger a page of recomputes). EVERY public surface is cache-only,
 * including the passport: a surface that recomputed on read would publish a number the list cannot
 * publish for the same VIN at the same instant, and the recomputing surface is the
 * authoritative-looking one, so that disagreement is the more damaging of the two. The
 * materialized position IS the public position; refreshCanonicalTrust is what makes it current.
 * What can no longer happen is a row publishing an unversioned 84 nobody can attribute.
 */
async function withCanonicalTrust(vehicles) {
  const rows = (vehicles || []).filter(Boolean);
  const trustByVin = await canonicalTrustForVins(rows.map((vehicle) => vehicle.vin));
  return rows.map((vehicle) => {
    const trust = trustByVin.get(vehicle.vin) || null;
    return { ...vehicle, trust_score: trust?.score ?? null, trust };
  });
}

/**
 * Governed per-VIN counts for the owner's garage — Issue #164 Phase 8, Cluster D.
 *
 * ## Why this exists
 *
 * My Garage rendered `{vehicle.documents?.length || 0} docs`, and the same shape for services, parts
 * and active insurance. NONE of those keys exists: `/api/vehicles/me` is `select('*')` on `vehicles`,
 * and the table has no `documents`, `service_records`, `parts` or `insurance_records` column
 * (measured on canonical staging). So every `?.` short-circuited and `|| 0` published an unmeasured
 * zero as a fact. Golden A showed "0 docs" against four verified documents and "0 parts" against a
 * real PartSentry log.
 *
 * A count that was never read is not zero. Every entry here is either a real number from a real
 * query or `null`, and `null` renders as words, never as a digit.
 *
 * The four sources are deliberately distinct. Parts come from `partsentry_logs` and services from
 * `mechanic_work_orders`: the per-VIN page derived BOTH from the same timeline filter, so Golden A's
 * single part log was published as "1 service AND 1 part" — one row counted twice.
 */
async function ownerGarageCounts(vins) {
  const wanted = [...new Set((vins || []).filter(Boolean))];
  const empty = { verified_documents: null, services: null, parts: null, active_insurance: null };
  if (wanted.length === 0) return new Map();

  // Each read is independent: one failing source must not blank the other three, and must not turn
  // into a zero for its own.
  const tally = async (table, columns, filter) => {
    try {
      let query = supabase.from(table).select(columns).in('vin', wanted);
      if (filter) query = filter(query);
      const { data, error } = await query;
      if (error) return null;
      const counts = new Map(wanted.map((vin) => [vin, 0]));
      for (const row of data || []) counts.set(row.vin, (counts.get(row.vin) || 0) + 1);
      return counts;
    } catch {
      return null;
    }
  };

  const [documents, services, parts, insurance] = await Promise.all([
    tally('vehicle_evidence', 'vin', (q) => q.in('verification_status', ['verified', 'confirmed', 'approved'])),
    tally('mechanic_work_orders', 'vin'),
    tally('partsentry_logs', 'vin'),
    tally('insurance_records', 'vin', (q) => q.eq('active', true)),
  ]);

  return new Map(wanted.map((vin) => [vin, {
    ...empty,
    verified_documents: documents ? documents.get(vin) ?? 0 : null,
    services: services ? services.get(vin) ?? 0 : null,
    parts: parts ? parts.get(vin) ?? 0 : null,
    active_insurance: insurance ? insurance.get(vin) ?? 0 : null,
  }]));
}

/**
 * Governed listing media for the owner's own vehicles — Issue #164 Phase 8, Run 4 (D5).
 *
 * ## Why this exists
 *
 * `/api/vehicles/me` is `select('*')` on `vehicles`, and `vehicles` HAS NO MEDIA COLUMN — the photos
 * live in `listing_images`. So every owner list surface read `vehicle.image_url`, got `undefined`,
 * and rendered the branded "Image unavailable" placeholder. Measured on Golden A: the PUBLIC listing
 * endpoint published `listing_media.state = "published"` with five canonical images at the same
 * moment the OWNER of those photos was told the image was unavailable.
 *
 * An owner may not know less true media than an anonymous buyer. This closes that gap by reading the
 * same table the public projection reads and building the block with the SAME function
 * (`toListingMediaBlock`) — the semantics are imported, never restated, so the two surfaces cannot
 * drift into disagreeing about what "published" means.
 *
 * ## Why the null matters
 *
 * `toListingMediaBlock(null)` is `not_loaded`; `toListingMediaBlock([])` is `none`. A failed read
 * therefore publishes "we did not look", never "there are none" — the same distinction
 * `ownerGarageCounts` draws for counts, and the reason a broken query can never again be published
 * to an owner as an absence of their own photographs.
 */
async function ownerListingMedia(vins) {
  const wanted = [...new Set((vins || []).filter(Boolean))];
  if (wanted.length === 0) return new Map();

  let rows = null;
  try {
    const { data, error } = await supabase
      .from('listing_images')
      .select('id, vin, image_url, is_primary, display_order')
      .in('vin', wanted);
    // `error` leaves `rows` null on purpose: see the note above.
    if (!error) rows = data || [];
  } catch {
    rows = null;
  }

  return new Map(wanted.map((vin) => [
    vin,
    toListingMediaBlock(rows === null ? null : rows.filter((row) => row.vin === vin)),
  ]));
}

/**
 * Order by canonical trust, highest first, with every unscored vehicle after every scored one.
 *
 * A vehicle with no canonical evaluation is NOT a zero and must not be ranked as one — it sorts
 * last in its original order rather than being pushed to the bottom of a numeric scale it was
 * never measured on.
 */
function rankByCanonicalTrust(vehicles) {
  return (vehicles || [])
    .map((vehicle, index) => ({ vehicle, index }))
    .sort((a, b) => {
      // Number.isFinite, matching the /api/vehicles filter: a NaN is not a rank position, and
      // `typeof NaN === 'number'` would sort it first.
      const aScore = Number.isFinite(a.vehicle?.trust?.score) ? a.vehicle.trust.score : null;
      const bScore = Number.isFinite(b.vehicle?.trust?.score) ? b.vehicle.trust.score : null;
      if (aScore === null && bScore === null) return a.index - b.index;
      if (aScore === null) return 1;
      if (bScore === null) return -1;
      return bScore - aScore || a.index - b.index;
    })
    .map((entry) => entry.vehicle);
}

// --- PILLAR 8: ADVANCED TAXONOMY & SEARCH ---
app.get('/api/vehicles', async (req, res) => {
  const { make, model, minPrice, maxPrice, drivetrain, dutyPaid, policeVerified, trustRange } = req.query;

  try {
    // Sanitized projection + full visibility gate: this legacy public endpoint
    // previously returned raw rows (owner_id, tenant_id, engine/chassis numbers)
    // and ignored the publication lifecycle entirely.
    let query = supabase.from('vehicles').select(PUBLIC_VEHICLE_SELECT);

    // Explicitly enforce public visibility constraint unless specifically fetching for a tenant (handled below or in another endpoint)
    query = query.in('status', publicVehicleStatusFilterValues());
    query = query.in('publication_status', publiclyVisiblePublicationStatuses());

    if (make) query = query.eq('make', make);
    if (model) query = query.eq('model', model);
    if (minPrice) query = query.gte('price', parseFloat(minPrice));
    if (maxPrice) query = query.lte('price', parseFloat(maxPrice));
    if (drivetrain) query = query.eq('drivetrain', drivetrain);
    if (dutyPaid !== undefined) query = query.eq('duty_paid', dutyPaid === 'true');
    if (policeVerified !== undefined) query = query.eq('police_verified', policeVerified === 'true');
    // NO `.gte('trust_score', …)` HERE. The stored column is an unversioned cache with several
    // writers: filtering on it lets a hand-set 84 satisfy "show me vehicles above 80" and lets a
    // legitimately-unscored vehicle be excluded by a number nobody can attribute. The threshold is
    // applied below against the CANONICAL score instead, where "no canonical evaluation" correctly
    // fails the filter rather than passing it on a legacy value.

    const { data: vehicles, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // PUBLIC_VEHICLE_SELECT no longer names the raw trust_score column at all (the projection
    // contract owns that list, and demoted it), so the only trust figure this route can publish is
    // the one attached here from the canonical projection. One query for the whole page; a vehicle
    // with no canonical evaluation publishes null plus the state that says why, never a stored
    // number — there is no longer a stored number in the row to fall back to.
    const projected = await withCanonicalTrust(vehicles);

    const threshold = trustRange === undefined ? null : parseFloat(trustRange);
    const filtered = threshold === null || !Number.isFinite(threshold)
      ? projected
      // A vehicle with no canonical score cannot satisfy a trust filter. It is not ranked at zero
      // and not admitted on the strength of an unversioned number — it is simply not an answer to
      // the question "which vehicles score at least N?". The predicate reads `trust.score`, the
      // authority's own field, rather than the `trust_score` key beside it, so no later edit to
      // that key can quietly put the legacy column back into the filter.
      : projected.filter((vehicle) => Number.isFinite(vehicle.trust?.score) && vehicle.trust.score >= threshold);

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLARS 1, 6 & 7: TRUST GRAPH, SCORE & PASSPORT ---

// Helper function to normalize plate numbers
function normalizePlate(plate) {
  if (!plate) return '';
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validatePassportLookupIdentifier(identifier) {
  const classified = classifyLookupIdentifier(identifier);
  return classified ? classified.value : null;
}

/**
 * Resolve an identifier to candidate VINs, searching only the columns its KIND permits.
 * A VIN lookup searches the vin column alone, so a public caller cannot supply a plate or
 * chassis number and discover the vehicle behind it.
 */
async function collectPassportLookupMatches(identifier, kind = LOOKUP_KINDS.RESTRICTED) {
  const norm = normalizePlate(identifier);
  const columns = lookupColumnsForKind(kind);

  const queries = [];
  if (columns.vehicles.includes('vin')) {
    queries.push(supabase.from('vehicles').select('vin').eq('vin', identifier));
  }
  if (columns.vehicles.includes('chassis_number')) {
    queries.push(supabase.from('vehicles').select('vin').eq('chassis_number', identifier));
  }
  if (columns.vehicles.includes('plate_number')) {
    queries.push(supabase.from('vehicles').select('vin').eq('plate_number', identifier));
  }
  if (columns.vehicles.includes('normalized_plate_number')) {
    queries.push(supabase.from('vehicles').select('vin').eq('normalized_plate_number', norm));
  }
  if (columns.vehicles.includes('temporary_identification_number')) {
    queries.push(supabase.from('vehicles').select('vin').eq('temporary_identification_number', identifier));
  }
  if (columns.plateHistory.includes('plate_number')) {
    queries.push(supabase.from('vehicle_plate_history').select('vin').eq('plate_number', identifier));
  }
  if (columns.plateHistory.includes('normalized_plate_number')) {
    queries.push(supabase.from('vehicle_plate_history').select('vin').eq('normalized_plate_number', norm));
  }

  const results = await Promise.all(queries);
  const firstError = results.find(result => result.error)?.error;
  if (firstError) throw firstError;

  const matchingVins = new Set();
  for (const result of results) {
    for (const row of (result.data || [])) {
      if (row.vin) matchingVins.add(row.vin);
    }
  }
  return matchingVins;
}

/**
 * Passport read limits. The passport is the richest public read CarUp serves, so both routes are
 * bounded independently of the global 100/min: bulk VIN sweeps and repeated identifier probing are
 * the two ways this surface gets mined. The identifier route is tighter because a caller who is
 * merely looking up their own car needs a handful of requests, not dozens.
 */
const passportLimiter = rateLimiter({ max: 30, windowMs: 60 * 1000, isSensitive: true });
const passportLookupLimiter = rateLimiter({ max: 10, windowMs: 60 * 1000, isSensitive: true });

// Roles that may read a passport at the owner audience regardless of who owns the
// vehicle. Kept narrow: widening this widens the unredacted identity surface.
const PASSPORT_PRIVILEGED_ROLES = new Set(['admin', 'government']);

/**
 * The canonical trust projection a passport publishes, read here rather than inside
 * buildVehiclePassport so the passport composes over a value it was handed instead of reaching for
 * an authority of its own — the same reason the vehicle row, the chain and the timeline are all
 * passed through governed projections.
 *
 * Every public surface reads the MATERIALIZED position, cache-only — the passport, the marketplace
 * list and detail, and the buyer-facing trust-decision route alike. None of them recomputes on
 * read, so they cannot disagree: they either all report the same score under the same
 * calculation_version, or all report that there is none. refreshCanonicalTrust is what makes that
 * position current.
 */
async function canonicalPassportTrust(vin) {
  // CACHE-ONLY, deliberately. Recomputing here would make the passport publish a number the
  // marketplace list cannot publish for the same VIN at the same instant — the list is cache-only
  // because 48 recomputes per page is not viable. Two public answers for one vehicle is the exact
  // defect this phase exists to close, and the recomputing surface is the authoritative-looking
  // one, so it is the more damaging of the two. The materialized position is the public position;
  // refreshCanonicalTrust is what makes it current.
  return publishCanonicalTrust(
    vin,
    await getCanonicalTrust(vin, { client: supabase, recompute: RECOMPUTE.NEVER }),
    'vehicle passport',
  );
}

// Structured helper to build and redact vehicle passport.
// Caller identity MUST already be resolved by optionalAuth() on the route: this
// function never reads x-session-token/x-user-id itself, because an unverified
// header must not be able to buy the owner audience.
//
// `canonicalTrust` is the ONE trust number this body publishes: the 10-field projection from
// canonicalTrustService (via canonicalPassportTrust above). Both routes supply it. A caller that
// supplies nothing gets `trustReport: null` — no projection accompanied this render — which is a
// statement about the request, never a score of zero for the vehicle.
//
// `listingClaimContract` is `toListingClaims` from utils/publicVehicleProjection.js, HANDED IN for
// exactly the reason `canonicalTrust` is: the passport composes over authorities it is given rather
// than reaching for one of its own. It is also what keeps this function's collaborator set closed —
// two independent harnesses (backend/tests/issue164-phase0-public-projection.test.js and the Phase 4
// review harness) execute this SOURCE against a fixed dependency list, and a free module-scope name
// added here is a ReferenceError there rather than a test failure that says what changed. A caller
// that supplies nothing gets `claims: null` — no claim contract accompanied this render — and the
// governed columns are withdrawn all the same, because "we could not state it" is never a licence
// to publish it bare.
//
// `attestClaim` is `attestedValue` from the same module, handed in for the same reason and subject
// to the same closed-collaborator rule. It exists because ONE governed business fact on this row —
// `currency` — has no leaf in the sealed claim contract, so there is no block to read it out of;
// the marketplace summary reaches for `attestedValue` directly for exactly the same reason
// (listingSummaryService.currencyClaim). Passing the SAME function both surfaces use is what stops
// the passport and the marketplace card answering the currency question differently for one
// vehicle. A caller that supplies nothing gets the currency withdrawn, not published bare.
//
// `mediaContract` is `toVehicleMedia` from utils/vehicleMediaProjection.js, handed in on the same
// closed-collaborator rule as the two above. It is what closes THE ORIGINAL DEFECT of this issue:
// the passport is Vehicle Detail's primary read and it never consulted `listing_images`, so a VIN
// whose Marketplace card showed a photo arrived at Detail with an empty gallery, under a control
// that then announced "No verified images uploaded yet" — a governance finding published over a
// table the passport had never heard of, about seller marketing photos that are never verified by
// anything. The read below fixes the plumbing; the contract fixes the sentence, by refusing to let
// a block that was not consulted say "none".
//
// A caller that supplies nothing publishes NEITHER media key — no media contract accompanied this
// render — on the rule `claims: null` and `trustReport: null` already follow. That is a statement
// about the REQUEST. It is deliberately not an empty pair of blocks: fabricating `{state:'none'}`
// for a projection that was never applied would re-commit the defect this parameter exists to
// close, one level up.
//
// THE CONTRACT ALSO HOLDS THE PUBLICATION GATE (its Rule 1b), and that is why the gate is expressed
// as two extra INPUTS to `mediaContract` below rather than as a branch in this function. Giving the
// passport its own `listing_images` read made an UNPUBLISHED listing's photographs reachable by any
// anonymous caller holding the VIN, on a surface where the marketplace answers 404 — nothing decided
// that, it fell out of the wiring. The remedy has to live where the definition of "published" is
// already imported, because deciding it here would mean inlining a second copy of that definition
// into the one function whose whole subject is that there is only one.
async function buildVehiclePassport(
  vin,
  req,
  canonicalTrust = null,
  listingClaimContract = null,
  attestClaim = null,
  mediaContract = null,
) {
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('vin', vin)
    .single();

  if (vehicleError || !vehicle) return null;

  // AUDIENCE. Read from `req.userContext` and from NO REQUEST HEADER.
  //
  // #165's invariant: this builder must not touch headers, because a builder that reads them can be
  // handed a forged owner audience. #175's invariant: what `isAuthorized` unlocks — the evidence
  // vault and the un-redacted timeline — must not be purchasable with an asserted `x-user-id`.
  //
  // Both hold because the STRICTNESS moved into `optionalAuth()`, the one middleware that populates
  // this context, rather than being re-implemented here. One identity path, strict policy.
  const actor = req.userContext || null;
  // A PROVEN identity only. `optionalAuth` resolves a header-asserted identity under the general
  // policy, which is fine for a route that merely needs to know who is calling. It is not fine
  // here: `isAuthorized` unlocks the evidence vault and the un-redacted timeline — a
  // private-document capability — so an ASSERTED identity must not buy it.
  //
  // Gated on the boolean the middleware publishes, not on the marker's string value: this builder
  // is asserted to read no request header, and the marker's value contains a header NAME, so
  // comparing against it would trip that guard while doing nothing wrong. Paired with a
  // producer-side test that `optionalAuth` ALWAYS publishes the flag — relying on a consumer
  // default is how a gate silently becomes a no-op when a new path forgets to set it.
  const provenIdentity = Boolean(actor?.id) && actor.identityAsserted !== true;
  const isAuthorized = provenIdentity && (
    PASSPORT_PRIVILEGED_ROLES.has(actor.role)
    || actor.id === vehicle.owner_id
  );

  // Fetch timeline, visual evidence, trust score report, and ledger verification
  const timeline = await getVehicleTimeline(vin);
  const { data: verifiedEvidence, error: evidenceError } = await supabase
    .from('vehicle_evidence')
    .select('*')
    .eq('vin', vin)
    .eq('visibility_level', 'public_safe')
    .eq('verification_status', 'verified')
    .order('captured_at', { ascending: true });

  if (evidenceError) throw evidenceError;

  const evidenceVault = (verifiedEvidence || []).map(normalizeEvidenceRecord);
  // Which evidence-derived timeline events point at a PRIVATE artifact. `evidenceToTimelineItem`
  // prefixes the row id with `evidence:`, and the timeline event carries no `storage_bucket` of its
  // own, so the bucket has to be resolved here from the raw rows.
  const privateEvidenceEventIds = new Set(
    (verifiedEvidence || [])
      .filter((row) => row?.storage_bucket === 'ocr-documents')
      .map((row) => `evidence:${row.id}`),
  );
  const visualTimeline = mergeEventsWithEvidence(timeline, evidenceVault);

  // ── THE TWO MEDIA MODELS, COMPOSED AND KEPT APART ─────────────────────────────────────────────
  // LISTING MEDIA is the seller's presentation: unverified marketing photos whose job is to show
  // the car. VERIFIED EVIDENCE is governed proof carrying provenance and a review decision. Vehicle
  // Detail needs BOTH, and merging them is how a marketplace photo becomes "verified" by the mere
  // act of being displayed. `toVehicleMedia` returns them as two sibling blocks with identical
  // envelopes and item shapes that share NOT ONE KEY NAME, which is what makes the separation a
  // property a test can execute rather than a convention a reviewer has to police.
  //
  // The contract's two keys are SPREAD onto the passport body rather than nested under a `media`
  // key, for a reason that is live rather than stylistic: `marketplaceListingDetailService` already
  // publishes a `media` key holding RAW `listing_images` ROWS, and Vehicle Detail holds both
  // payloads at once. One name over two shapes on one page is how `toListingMediaBlock(<object>)`
  // gets called on a projected block, returns `not_loaded` without throwing, and blanks a gallery
  // silently — this defect exactly, through a new door. `listing_media`/`verified_evidence` name
  // themselves and collide with nothing. Publishing one and forgetting the other is prevented by
  // the spread being a single expression over the contract's own frozen return, whose key set
  // issue164-phase5-media-contract.test.js asserts.
  let listingImageRows;   // stays `undefined` unless this read actually ran and returned rows
  if (typeof mediaContract === 'function') {
    // Keyed by `vin`, the only key `listing_images` has (it is FK'd to vehicles(vin) ON DELETE
    // CASCADE — referential integrity was never the problem; NOBODY JOINING IT was).
    //
    // The column list is narrow and deliberate: exactly the four the contract consumes.
    //
    // `id` IS selected and IS published, as `media_id` — the item's stable opaque identity (Rule
    // 6b). It is the row's uuid primary key, so the same photograph answers to the same identity on
    // every surface and across every read, which URL equality cannot promise: a URL survives being
    // rewritten by a CDN or a resize and two site-relative paths can collide, and 3 of 3 rows here
    // are exactly such paths. Selecting it is not a widening — `vehicle_evidence.id` has been
    // public since Phase 0 — and it discloses nothing, because this table has no locator column to
    // derive: it is (id, vin, image_url, is_primary, display_order, created_at) and `image_url` is
    // already published beside it.
    //
    // `created_at` must NOT be selected — it is the row's INSERT time, and a date beside a photo
    // reads as when the photo was taken. `vehicle_evidence` has `captured_at` for that, behind a
    // review; `listing_images` has no such column and no reviewer, no uploader, no checksum and no
    // status, which is precisely why nothing in this block may make a trust claim.
    const { data: listingImages, error: listingImagesError } = await supabase
      .from('listing_images')
      .select('id, image_url, is_primary, display_order')
      .eq('vin', vin)
      .order('display_order', { ascending: true });

    // A failed gallery read must NOT 500 the passport (unlike evidence above, whose absence would
    // silently understate governance), and it must not be laundered into `[]` either. Leaving the
    // value undefined yields `state: 'not_loaded'` with a NULL statement, so the surface renders
    // nothing rather than an empty-gallery sentence about a table we could not reach. Saying "none"
    // on the strength of a read that never succeeded is the original defect.
    if (!listingImagesError) listingImageRows = listingImages || [];
  }

  // ── WHY THE GALLERY IS STILL READ FOR A LISTING WE MAY NOT PUBLISH ────────────────────────────
  // The publication gate (Rule 1b) is applied by the CONTRACT, not here, and this read deliberately
  // runs regardless of it. Three reasons, in order of weight:
  //
  //   1. ONE DEFINITION. Skipping the read would mean asking "is this listing published?" at this
  //      call site, and the only way to ask it from inside this function is to inline the predicate
  //      — `vehicle.publication_status === 'published'` — because the passport's collaborator set is
  //      CLOSED (see the header): the canonical `publiclyVisiblePublicationStatuses()` is not among
  //      the injected names and adding a free one is a ReferenceError in three certified harnesses.
  //      An inlined literal is a SECOND definition of published, on the surface whose whole subject
  //      is that there is one. The contract already imports the canonical set; it decides.
  //   2. THE ROWS NEVER LEAVE THE PROCESS. `toGatedListingMediaBlock` discards them entirely for an
  //      ungated caller — not counted, not summarised — so reading them leaks nothing. What must not
  //      escape is the PROJECTION, and that is precisely what the contract refuses to build.
  //   3. IDENTICAL WORK EITHER WAY. A draft listing and a published one issue the same queries in
  //      the same order, so response time carries no signal about publication state or about
  //      whether a hidden listing holds photographs. A conditional read would have introduced that
  //      signal to save a query on 2 of 16 staging rows.
  //
  // ── THE TWO AUDIENCES BELOW ARE TWO DIFFERENT FACTS ───────────────────────────────────────────
  // `audience: 'public'` is the EVIDENCE audience, and it is 'public' on every render, which is not
  // an oversight. The evidence rows in hand were fetched above under `public_safe AND verified` for
  // every caller, so asking the contract for the 'owner' audience would claim a widening this query
  // never performed. The owner's unredacted vault is `evidenceVault` below, which is separately
  // audience-gated and is not this block's business. Re-applying the same gate the SQL applied is
  // defence in depth: the projection must never depend on a caller having remembered the filter.
  //
  // `listingAudience` is the LISTING audience and is a SEPARATE parameter for a reason that is the
  // whole subject of this phase: evidence is truth about a VEHICLE and listing media is content on a
  // LISTING. A vehicle's verified registration document does not become unverified because nobody is
  // advertising the car, so the publication gate governs the gallery and NOTHING else. It resolves
  // to 'owner' for exactly the callers `isAuthorized` already names — the vehicle's owner and
  // PASSPORT_PRIVILEGED_ROLES (admin, government), each from a session `optionalAuth()` verified —
  // so those paths keep the access they had and nothing about them changes.
  //
  // `vehicle.publication_status` is passed RAW, straight off the row this function already read.
  // No second query, therefore no second failure mode: if the vehicle read fails, this function has
  // already returned null and there is no passport at all. If the column is somehow absent from the
  // row, the contract resolves UNDETERMINED and answers `not_loaded` — closed, and silent.
  const vehicleMedia = typeof mediaContract === 'function'
    ? mediaContract({
      listingImageRows,
      evidenceRows: evidenceVault,
      audience: 'public',
      listingPublicationStatus: vehicle.publication_status,
      listingAudience: isAuthorized ? 'owner' : 'public',
    })
    : null;

  // THE PASSPORT'S TRUST NUMBER, FROM THE CANONICAL AUTHORITY AND NOWHERE ELSE.
  //
  // This used to be `computeVehicleTrustScore(vin)`, the deprecated 70-baseline trustGraph engine,
  // whose number was shipped as `trustReport` and rendered live. For one VIN that engine published
  // 90 while the trust-decision route published 50 and the marketplace card published 84 — three
  // numbers, one vehicle, no version stamp on any of them. The value is now the canonical
  // projection supplied by the route (canonicalPassportTrust), carrying calculation_version and
  // evaluation_state so a reader can tell a current score from a withheld or absent one.
  const trustReport = canonicalTrust ?? null;

  // The non-score signals the passport has always shown (ZIMRA/CVR/ZRP/odometer/ledger/service
  // records). They are FACTS COLLECTED, not a score: the deprecated engine's own `trustScore` is
  // discarded here rather than republished under a new name, and `evidence_trust_impact` — a raw
  // scoring component — is dropped with it, so the passport body carries exactly one trust number.
  const legacySignalReport = await computeVehicleTrustScore(vin);
  const legacyMetrics = legacySignalReport && typeof legacySignalReport === 'object'
    ? legacySignalReport.metrics
    : null;
  const trustSignals = legacyMetrics
    ? {
      cvr_synced: legacyMetrics.cvr_synced,
      zimra_duty: legacyMetrics.zimra_duty,
      zrp_police_cleared: legacyMetrics.zrp_police_cleared,
      blockchain_audit_valid: legacyMetrics.blockchain_audit_valid,
      odometer_consistent: legacyMetrics.odometer_consistent,
      maintenance_logs_count: legacyMetrics.maintenance_logs_count,
      stolen_alert_active: legacyMetrics.stolen_alert_active,
      verified_evidence_count: legacyMetrics.verified_evidence_count,
      rejected_evidence_count: legacyMetrics.rejected_evidence_count,
      // Stated so a client cannot mistake these for the trust assessment: they are inputs that were
      // observed, and none of them is a CarUp verdict on the vehicle.
      signals_are_not_a_trust_score: true,
    }
    : null;

  const chainVerification = await verifyChain(vin);

  // Fetch plate history
  const { data: plateHistory } = await supabase
    .from('vehicle_plate_history')
    .select('*')
    .eq('vin', vin)
    .order('created_at', { ascending: false });

  // Get previous owners count
  const { data: ownershipHistory } = await supabase
    .from('vehicle_ownership_history')
    .select('*')
    .eq('vin', vin);
  const previousOwnerCount = ownershipHistory ? ownershipHistory.length : 0;

  // Resolve current seller details. Principle 4: a seller that is not recorded, or
  // whose name we cannot resolve, stays null — never a stand-in like 'Private Seller',
  // which reads as a recorded fact and is indistinguishable from a real answer.
  const currentSellerRecorded = Boolean(vehicle.current_seller_id);
  let currentSellerDisplayName = null;
  if (currentSellerRecorded) {
    const { data: sellerUser } = await supabase
      .from('users')
      .select('name')
      .eq('id', vehicle.current_seller_id)
      .single();
    if (sellerUser?.name) {
      currentSellerDisplayName = sellerUser.name;
    }
  }

  const currentOwnerVisible = isAuthorized || !!vehicle.public_seller_display_enabled;

  // ── THE PASSPORT PUBLISHES CLAIMS, NOT COLUMNS ────────────────────────────────────────────────
  // The canonical listing claim contract for this row, at this audience. Every leaf is a stated
  // pair {value, state, source}, and `registration.*` is provenance-gated: a country with no
  // recognised `registration_country_source` publishes `not_recorded`, whatever sits in the column.
  //
  // This is the treatment every other public surface already gives these facts. The passport was the
  // one that still published the raw row — `vehicle.registration_country: "ZW"` and
  // `identity.registrationCountry: "ZW"`, on 13 of 16 staging rows where nobody had ever stated a
  // country. The passport is the surface a shopper trusts MOST, which made it the worst place for it.
  const claims = typeof listingClaimContract === 'function'
    ? listingClaimContract(vehicle, {
      audience: isAuthorized ? 'owner' : 'public',
      // Resolved above even when this audience may not see it, which is the caller obligation that
      // lets `display_label` tell `withheld` apart from `not_recorded`. The claim's consent gate is
      // STRICTER than ownershipSummary's (`=== true` vs a coercion), so it can never publish a name
      // the summary beside it would have withheld.
      sellerDisplayName: currentSellerDisplayName,
    })
    : null;

  // Built AFTER `claims` on purpose: `currentSellerType` now reads the governed leaf instead of the
  // column, and the two must be the same value or the body contradicts itself.
  const ownershipSummary = {
    // null + currentSellerRecorded true + currentOwnerVisible false => withheld.
    // null + currentSellerRecorded false                            => not recorded.
    currentSellerDisplayName: currentOwnerVisible ? currentSellerDisplayName : null,
    // WAS `vehicle.current_seller_type ?? null`, and that was the fabrication §5.6 self-flagged:
    // the column carries DB DEFAULT 'Private Owner' and holds it on 13 of 16 staging rows, so an
    // ungated read published "this is a private sale" on the authority of the DDL. Withdrawing the
    // column from the row projection below and leaving this line alone would have moved the same
    // string four keys down the SAME response body, camelCased — a cosmetic strip, not a closure.
    // `claims.seller.seller_type` is the governed home of this fact (provenance-gated on
    // `current_seller_type_source`), so this reads that leaf and cannot disagree with it.
    //
    // A null here is unambiguous and needs no companion state key: `toSellerClaim` never WITHHOLDS
    // a seller type — it has no audience gate — so the only non-recorded state this leaf can reach
    // is `not_recorded`, which is exactly what VehicleDetail.tsx already renders a null as. The
    // state is in `claims.seller.seller_type.state` in the same body for a reader that wants it.
    // No claim contract handed in => null, on the same rule the governed columns are withdrawn on.
    currentSellerType: claims?.seller?.seller_type?.value ?? null,
    currentSellerRecorded,
    previousOwnerCount,
    previousOwnersPublicLabel: 'Redacted for privacy',
    ownerNamesRedacted: !isAuthorized,
    currentOwnerVisible
  };

  // Columns the claim contract governs, withdrawn from the row projection so each fact appears
  // ONCE, stated. Every one of them is manufactured by a column DEFAULT — 'ZW' / 'CVR' / 'Current' /
  // 'Active' on 16 of 16 staging rows, with ZERO application writers for the last three — so the
  // bare copies were not a stale reading of something real; they were the schema talking. A second,
  // unstated copy of a governed fact is also the exact hazard `isStatedValue` refuses inside a pair,
  // and it does not stop being one because it sits in a neighbouring object.
  const CLAIM_GOVERNED_COLUMNS = [
    'registration_country', 'registration_authority', 'registration_status', 'plate_status',
    // ADDED — `current_seller_type`, the fifth column of this species and the one the contract doc
    // flagged as §5.6. DEFAULT 'Private Owner', 'Private Owner' on 13 of 16 staging rows, and its
    // governed twin is `claims.seller.seller_type` — a one-to-one correspondence, exactly like the
    // four registration columns above. Left in the projection it published a bare "Private Owner"
    // beside a `claims.seller.seller_type` reporting `not_recorded` for the same vehicle in the
    // same body: one question, two answers, and the unstated one looks like the confident one.
    'current_seller_type',
  ];
  // `import_source` (D7, same species: the write path stored 'local' for every submission that
  // omitted it) is withdrawn WITHOUT a claim to replace it, because the sealed contract has no leaf
  // for it and no `import_source_source` column exists to gate one — a value here cannot be told
  // apart from a seller's real declaration of 'local'. It is not published as `withheld` either:
  // nothing recorded means nothing to withhold, and a fabricated withholding is the same defect
  // wearing the opposite mask. Widening LISTING_CLAIM_BLOCKS is a reviewed change to the contract,
  // not something a route may do on its way past.
  const UNCLAIMABLE_COLUMNS = ['import_source'];

  // `currency` — the sixth DEFAULT-authored business fact on this row, and the ONE the sealed claim
  // contract has no leaf for, which is why it is gated here instead of appearing in the list above.
  // Measured on staging: DEFAULT 'USD', 'USD' on 16 of 16 rows, one distinct value, zero NULLs —
  // the same signature that convicted `registration_authority` and `plate_status`. The marketplace
  // summary and the pricing estimator already publish it only when a `currency_source` names who
  // asserted it (listingSummaryService.currencyClaim, re-derived in marketplacePricingService); the
  // passport did not, so the identical fabrication went on being served from the surface a shopper
  // trusts most, on the one public read no mutation in this phase covered.
  //
  // GATED, NOT DELETED, and gated on PROVENANCE rather than on the value: 'USD' is not rejected for
  // being the default's string — a seller who genuinely trades in USD must be able to say so, and
  // rejecting the value would be the mirror-image fabrication. It is rejected for having no author.
  //
  // `price` is deliberately left ungated beside it. It carries no DB default and `/api/vehicles/add`
  // 400s a submission without one, so a price in the column IS an application-recorded fact.
  // Currency was the half the database was answering for.
  const currencyClaim = typeof attestClaim === 'function'
    ? attestClaim(vehicle.currency, vehicle.currency_source)
    : null;

  const withGovernedClaims = ({ vehicle: projected, claims: stated }) => {
    const published = { ...projected };
    for (const column of [...CLAIM_GOVERNED_COLUMNS, ...UNCLAIMABLE_COLUMNS]) delete published[column];
    if (currencyClaim) {
      // The same three keys `buildMarketplaceListingSummary` publishes, in the same order, carrying
      // the same states — so a client reading a card and a passport for one VIN reads one shape and
      // one answer. `currency_state` says WHY a null is null, which the bare column never did.
      published.currency = currencyClaim.value;
      published.currency_state = currencyClaim.state;
      published.currency_source = currencyClaim.source;
    } else {
      // No attestor accompanied this render, so nothing here can tell a currency a seller stated
      // from the one the DDL wrote. Withdrawn on the `import_source` rule rather than published
      // bare, and NOT published as a fabricated `not_recorded` either: this branch is a statement
      // about the request, and inventing a state for it would be the same defect wearing the
      // opposite mask.
      delete published.currency;
    }
    return { vehicle: published, claims: stated };
  };

  // Structured Privacy Redaction Layer.
  // Free text is part of the response body: an identifier interpolated into a
  // sentence escapes the structured redaction in `identity` just as surely as a
  // stray column would, and a key-name leak scan cannot see it. Every identifier
  // read below is therefore gated on isAuthorized, and an unauthorized description
  // names the EVENT rather than emitting a placeholder where a value would sit.
  // A plate-history row that is not marked public governs its derived timeline events too:
  // suppressing the number while still announcing "plate flagged: <reason>" would publish the
  // very record the row withheld. Event ids are `<source>:<plateHistoryId>`, so the withheld
  // rows identify their own events.
  const withheldPlateEventIds = isAuthorized
    ? new Set()
    : new Set(
        (plateHistory || [])
          .filter(row => row.record_visibility !== 'public')
          .map(row => String(row.id))
      );

  const audienceTimeline = withheldPlateEventIds.size === 0
    ? visualTimeline
    : visualTimeline.filter(event => {
        if (!String(event.event_source || '').startsWith('plate_') &&
            event.event_source !== 'temporary_id_issued') return true;
        return !withheldPlateEventIds.has(String(event.id || '').split(':').pop());
      });

  const sanitizedTimeline = audienceTimeline.map(event => {
    const plateValue = isAuthorized
      ? (event.details?.plateNumber || vehicle.plate_number || null)
      : null;
    const tempIdValue = isAuthorized
      ? (event.details?.plateNumber || vehicle.temporary_identification_number || null)
      : null;
    // plate_verification_source is owner-audience only in the projection contract.
    const verificationSource = event.details?.verificationSource
      || (isAuthorized ? vehicle.plate_verification_source : null)
      || null;

    // Generate publicDescription and publicSummary
    let publicDescription = event.desc || '';
    let publicSummary = event.label || '';

    if (event.event_source === 'cvr') {
      publicDescription = plateValue
        ? `Registered plate ${plateValue}. Owner name redacted for privacy.`
        : 'Registration recorded with CVR. Owner name redacted for privacy.';
      publicSummary = 'CVR Registration';
    } else if (event.event_source === 'ownership_transfer') {
      publicDescription = 'Ownership transferred to next owner';
      publicSummary = 'Ownership Transfer';
    } else if (event.event_source === 'zimra') {
      publicDescription = 'Import duty customs clearance confirmed';
      publicSummary = 'ZIMRA Customs';
    } else if (event.event_source === 'service' && String(event.id || '').startsWith('workorder:')) {
      // WORK ORDERS ONLY, keyed on the id prefix — not every `service` event.
      //
      // Work orders come from a table carrying free text plus `customer_name`/`customer_id`, so their
      // public description is fixed here as a second line of defence behind the producer's column
      // withholding. PartSentry events share `event_source` but are structured and non-sensitive:
      // they publish e.g. "Front brake pads (Replaced)", which the public Detail page uses. An
      // unscoped branch here would have suppressed that real governed information — a fix broader
      // than the property it needed, which is the same error as one that is too narrow.
      publicDescription = 'Service record signed by a mechanic';
      publicSummary = 'Service Record';
    } else if (event.event_source === 'insurance') {
      publicDescription = 'Insurance policy premium set';
      publicSummary = 'Insurance Insured';
    } else if (event.event_source === 'plate_assigned') {
      publicDescription = plateValue
        ? `Number plate assigned: ${plateValue}`
        : 'Number plate assigned';
      publicSummary = 'Plate Assigned';
    } else if (event.event_source === 'temporary_id_issued') {
      publicDescription = tempIdValue
        ? `Temporary identification number issued: ${tempIdValue}`
        : 'Temporary identification number issued';
      publicSummary = 'Temporary ID Issued';
    } else if (event.event_source === 'plate_verified') {
      const subject = plateValue ? `Number plate ${plateValue} verified` : 'Number plate verified';
      publicDescription = verificationSource ? `${subject} via ${verificationSource}` : subject;
      publicSummary = 'Plate Verified';
    } else if (event.event_source === 'plate_changed') {
      publicDescription = plateValue
        ? `Number plate ${plateValue} retired or changed`
        : 'Number plate retired or changed';
      publicSummary = 'Plate Changed';
    } else if (event.event_source === 'plate_flagged') {
      const subject = plateValue ? `Number plate ${plateValue} flagged` : 'Number plate flagged';
      publicDescription = `${subject}: ${event.details?.reason || 'No reason provided'}`;
      publicSummary = 'Plate Flagged';
    } else if (event.event_source === 'plate_suspended') {
      const subject = plateValue ? `Number plate ${plateValue} suspended` : 'Number plate suspended';
      publicDescription = `${subject}: ${event.details?.reason || 'No reason provided'}`;
      publicSummary = 'Plate Suspended';
    } else if (event.event_source === 'evidence') {
        // `event.desc` is the reviewer's `verification_notes` — operator free text that can name
        // an identifier — and this field is the PUBLIC description. Gating it on `isAuthorized`
        // and reusing the same field is how a reviewed document's notes reached an anonymous
        // caller verbatim, so the note never reaches this field for ANY audience. An owner reads
        // reviewer notes through the owner surfaces, not the passport's public description.
        publicDescription = 'Verified evidence linked to this vehicle passport';
      publicSummary = event.label || 'Verified Evidence';
    }

    const publicDescriptionVal = publicDescription;
    const publicSummaryVal = publicSummary;

    // Build the sanitized event
    const sanitizedEvent = {
      ...event,
      publicDescription: publicDescriptionVal,
      publicSummary: publicSummaryVal,
    };

    if (!isAuthorized) {
      // Redact details that leak PII
      sanitizedEvent.desc = publicDescriptionVal;
      sanitizedEvent.label = publicSummaryVal;
      sanitizedEvent.details = {
        // Keep safe details. plateNumber is not one of them: it is the value
        // identity.plateNumber withholds, only camelCased onto a timeline row.
        // Blanked rather than dropped, so the client renders a withheld state;
        // identity.identifiersRedacted says which state a null means.
        mileage: event.details?.mileage,
        stage: event.details?.stage,
        plateType: event.details?.plateType,
        status: event.details?.status,
        brakingEfficiency: event.details?.brakingEfficiency,
        suspensionPassed: event.details?.suspensionPassed,
        steeringPassed: event.details?.steeringPassed,
        odometer: event.details?.odometer,
        termEnd: event.details?.termEnd,
        reason: event.details?.reason,
        verificationSource: event.details?.verificationSource,
        plateNumber: null,
      };

      // CLOSE THE TOP LEVEL TOO — the FOURTH door.
      //
      // Allow-listing only `details` left the event's own top level open, and an evidence-derived
      // event carries its source row's columns up there. Verified live on the deployed passport
      // before this change:
      //
      //   timeline[] evidence event → file_url: "<VIN>/golden-registration_document.pdf"
      //
      // i.e. the private bucket-relative locator, published to an anonymous caller through the
      // timeline after the vault beside it had been closed. `metadata` rides up the same way and
      // carries `ai_ready.vehicle_identity` (vin, plate, chassis, engine) on a real row, and `desc`
      // defaults to the reviewer's `verification_notes` for any event_source the branch chain above
      // does not override — `evidence` being one of them.
      if (event.event_source === 'evidence') {
        // Only a PRIVATE artifact loses its locator. Nulling every evidence event's `file_url` also
        // stripped verified `public_safe` images in the PUBLIC `vehicle-images` bucket, which the
        // other projections deliberately keep so clients can render them — a fix mis-sized against
        // the property it claims, which would have silently emptied the passport's imagery.
        if (privateEvidenceEventIds.has(event.id)) sanitizedEvent.file_url = null;
        sanitizedEvent.metadata = {};
      }
      return toPublicTimelineEvent(sanitizedEvent);
    }

    return sanitizedEvent;
  });

  return {
    // `vehicle` is the audience projection with the claim-governed columns withdrawn; `claims` is
    // the contract that states them. The projection decides which columns an audience may SEE; the
    // claim contract decides which values are attested enough to PUBLISH, and both gates apply.
    ...withGovernedClaims({
      vehicle: projectVehicle(vehicle, isAuthorized ? 'owner' : 'public'),
      claims,
    }),
    timeline: sanitizedTimeline,
    evidenceTimeline: sanitizedTimeline.filter(event => event.event_source === 'evidence'),
    // THE THIRD ANONYMOUS DOOR.
    //
    // `verifiedEvidence` above is `select('*')`, and this array was returned unchanged to every
    // caller — so `/api/vehicles/:vin/passport` and `/api/vehicles/passport/lookup/:identifier`
    // published the same 54-column rows the two evidence routes were just closed against:
    // plate/chassis/engine identifiers, uploader and reviewer ids, tenant id, reviewer free text,
    // and the private storage locator. Verified live before this change.
      // The media contract's blocks (`listing_media`, `verified_evidence`) reach the passport BODY
      // through this spread. Dropping it publishes a passport with no gallery at all.
      ...(vehicleMedia ?? {}),
    evidenceVault: isAuthorized ? evidenceVault : evidenceVault.map(toPublicEvidence),
    trustReport,
    // Same signals as before, minus every score. Kept OUT of trustReport because that object's key
    // set is the public trust contract and may not be extended.
    trustSignals,
    // chain[] carries each ledger event's raw uncontrolled payload, which in practice holds
    // owner names. Unauthorized callers get the integrity verdict only, never the entries.
    chainVerification: isAuthorized
      ? chainVerification
      : { verified: chainVerification.verified, count: chainVerification.count, chain: [] },
    identity: {
      vin: vehicle.vin,
      chassisNumber: isAuthorized ? vehicle.chassis_number : null,
      plateNumber: isAuthorized ? vehicle.plate_number : null,
      normalizedPlateNumber: isAuthorized ? vehicle.normalized_plate_number : null,
      temporaryIdentificationNumber: isAuthorized ? vehicle.temporary_identification_number : null,
      engineNumber: isAuthorized ? vehicle.engine_number : null,
      // `plateStatus`, `registrationStatus`, `registrationCountry` and `registrationAuthority` used
      // to sit here as bare columns, and they are the four leaves of `claims.registration` — a
      // one-to-one correspondence, so the block above is their governed home and this is where the
      // duplicate went. They were also the four columns whose DB DEFAULTs ('Active' / 'Current' /
      // 'ZW' / 'CVR') fill every row with an assertion no registry, operator or seller ever made,
      // which is why publishing the value here was a fabrication and not merely a duplication.
      // A reader that needs registration facts reads `claims.registration`, where each one arrives
      // with the state and the source that say whether it is a fact at all.
      plateVerifiedAt: isAuthorized ? vehicle.plate_verified_at : null,
      plateVerificationSource: isAuthorized ? vehicle.plate_verification_source : null,
      // A null identifier above means withheld from this audience, not unrecorded —
      // the client must not render it as an absent fact.
      identifiersRedacted: !isAuthorized
    },
    plateHistory: isAuthorized ? (plateHistory || []) : toPublicPlateHistory(plateHistory),
    // An empty public list means one of two different things. Without this the client renders
    // "No previous plates logged in history" over a vehicle whose history was merely withheld —
    // the collection-level form of the withheld/unrecorded conflation identity already avoids.
    plateHistoryRedacted: !isAuthorized
      && (plateHistory || []).length > toPublicPlateHistory(plateHistory).length,
    ownershipSummary
  };
}

// Canonical VIN passport lookup.
// optionalAuth() resolves identity when one is genuinely present and never blocks:
// the passport stays publicly reachable, only its audience changes.
app.get('/api/vehicles/:vin/passport', passportLimiter, optionalAuth(), async (req, res) => {
  const { vin } = req.params;
  try {
    const passport = await buildVehiclePassport(vin, req, await canonicalPassportTrust(vin), toListingClaims, attestedValue, toVehicleMedia);
    if (!passport) {
      return res.status(404).json({ error: 'VIN not found' });
    }
    res.json(passport);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Multi-identifier passport lookup route. Same audience rule as /:vin/passport —
// resolving by plate/temp id must not be a cheaper route to the owner audience.
app.get('/api/vehicles/passport/lookup/:identifier', passportLookupLimiter, optionalAuth(), async (req, res) => {
  const classified = classifyLookupIdentifier(req.params.identifier);
  if (!classified) {
    return res.status(400).json({ error: 'Invalid lookup identifier' });
  }

  // Plate / temporary-id / chassis lookup is gated BEFORE any query runs. Answering from the
  // policy alone is what makes the response non-enumerable: an unauthenticated caller gets the
  // same status, the same body and the same timing whether or not the identifier exists.
  const access = resolveLookupAccess({
    kind: classified.kind,
    actor: req.userContext || null,
    sellerOptIn: await resolveSellerLookupOptIn(classified),
  });
  if (access.decision !== LOOKUP_DECISIONS.ALLOW) {
    return res
      .status(NON_ENUMERABLE_LOOKUP_RESPONSE.status)
      .json(NON_ENUMERABLE_LOOKUP_RESPONSE.body);
  }

  const identifier = classified.value;
  try {
    const matchingVins = await collectPassportLookupMatches(identifier, classified.kind);

    if (matchingVins.size === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    if (matchingVins.size > 1) {
      return res.status(409).json({ error: 'Multiple vehicles match this identifier. Please search by VIN.' });
    }

    const resolvedVin = Array.from(matchingVins)[0];
    const passport = await buildVehiclePassport(resolvedVin, req, await canonicalPassportTrust(resolvedVin), toListingClaims, attestedValue, toVehicleMedia);
    if (!passport) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    res.json(passport);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 18: BLOCKCHAIN INTEGRITY SCANNER ---
app.get('/api/vehicles/:vin/verify-ledger', async (req, res) => {
  const { vin } = req.params;
  try {
    const report = await verifyChain(vin);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 1: ODOMETER AUDITOR ---
app.get('/api/vehicles/:vin/odometer-audit', async (req, res) => {
  const { vin } = req.params;
  try {
    const audit = await runOdometerAudit(vin);
    res.json(audit);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 2: SAFEPAY ESCROW TRANSACTION ENGINE ---
app.post('/api/safepay/create', authorizeRole(), async (req, res) => {
  const { vin, sellerId, amount, currency } = req.body;
  const buyerId = req.userContext.userId;
  try {
    const escrow = await createEscrow(vin, buyerId, sellerId, amount, currency);
    res.json(escrow);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/safepay/list', authorizeRole(), async (req, res) => {
  const { userId, role } = req.userContext;
  try {
    const escrowSelect = '*, vehicles(make, model, year, price, currency), buyer:users!safepay_escrows_buyer_id_fkey(name, email, phone), seller:users!safepay_escrows_seller_id_fkey(name, email, phone)';
    const baseEscrowQuery = () => supabase
      .from('safepay_escrows')
      .select(escrowSelect)
      .order('created_at', { ascending: false });

    // Scope queries depending on who is asking
    let escrows = [];
    let error = null;
    if (role === 'dealer' || role === 'owner') {
      const [sellerResult, buyerResult] = await Promise.all([
        baseEscrowQuery().eq('seller_id', userId),
        baseEscrowQuery().eq('buyer_id', userId)
      ]);
      error = sellerResult.error || buyerResult.error;
      const escrowMap = new Map();
      for (const escrow of [...(sellerResult.data || []), ...(buyerResult.data || [])]) {
        escrowMap.set(escrow.id, escrow);
      }
      escrows = [...escrowMap.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (role === 'bank') {
      // For banks we just let them see all, or we could filter based on finance apps (simplified)
      const result = await baseEscrowQuery();
      escrows = result.data || [];
      error = result.error;
    } else {
      const result = await baseEscrowQuery().eq('buyer_id', userId);
      escrows = result.data || [];
      error = result.error;
    }

    if (error) throw error;
    
    // Flatten relational data for the frontend
    const flattened = escrows.map(e => ({
      ...e,
      vehicle: e.vehicles ? `${e.vehicles.make} ${e.vehicles.model} (${e.vehicles.year})` : 'Unknown Vehicle',
      buyer_name: e.buyer?.name,
      seller_name: e.seller?.name
    }));

    res.json(flattened);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/safepay/:id/update', authorizeRole(), async (req, res) => {
  const { id } = req.params;
  const { status, details } = req.body;
  try {
    const escrow = await updateEscrowStatus(id, status, details);
    res.json(escrow);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/safepay/webhook', async (req, res) => {
  const signature = req.headers['x-safepay-signature'];
  const payload = JSON.stringify(req.body);
  const secret = process.env.SAFEPAY_WEBHOOK_SECRET || 'safepay_secret_key';

  if (!signature) {
    return res.status(401).json({ error: 'Missing x-safepay-signature header' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(403).json({ error: 'Invalid webhook signature' });
  }

  const { escrow_id, event, status, details } = req.body;

  try {
    if (event === 'payment.received') {
      const escrow = await updateEscrowStatus(escrow_id, status || 'Escrowed', details || 'Payment cleared via Webhook.');
      return res.json({ success: true, escrow });
    }
    res.json({ success: true, message: 'Event ignored' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 3: PARTSENTRY REPAIR LEDGER ---
// Mechanics log freely; an owner/dealer/admin may only log against a vehicle
// they own or that belongs to their tenant (the owner PartSentry page was
// 403-dead against the mechanic-only guard while faking success client-side).
app.post('/api/partsentry/add', authorizeRole(['mechanic', 'owner', 'dealer', 'admin']), async (req, res) => {
  const { vin, partName, partOem, actionType, description, mileage } = req.body;
  const actorId = req.userContext.id;
  try {
    if (req.userContext.role !== 'mechanic' && req.userContext.role !== 'admin') {
      const { data: vehicleRow, error: vehicleErr } = await supabase
        .from('vehicles')
        .select('owner_id, tenant_id')
        .eq('vin', vin)
        .maybeSingle();
      if (vehicleErr) throw new Error('Vehicle ownership lookup failed.');
      if (!vehicleRow) return res.status(404).json({ error: 'Vehicle not found.' });
      const ownsVehicle = vehicleRow.owner_id && vehicleRow.owner_id === req.userContext.id;
      const sameTenant = vehicleRow.tenant_id && vehicleRow.tenant_id === req.userContext.tenantId;
      if (!ownsVehicle && !sameTenant) {
        return res.status(403).json({ error: 'You may only log parts against your own vehicle.' });
      }
    }
    const log = await addRepairLog(vin, actorId, partName, partOem, actionType, description, mileage, req.userContext.tenantId ?? null);
    res.json(log);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Public callers see the governed public ledger only; the vehicle's verified
// owner, a mechanic or an admin see the full history — otherwise a mechanic's
// or owner's fresh write is invisible on re-read until public-card review.
app.get('/api/partsentry/:vin', optionalAuth(), async (req, res) => {
  const { vin } = req.params;
  try {
    let publicOnly = true;
    const ctx = req.userContext;
    if (ctx?.id) {
      if (ctx.role === 'mechanic' || ctx.role === 'admin') {
        publicOnly = false;
      } else {
        // optionalAuth() takes tenantId from the UNVERIFIED x-tenant-id header
        // claim — it never checks tenant membership (authMiddleware is
        // PR-#137-owned, so the consumer must not trust it). Full-history
        // widening is therefore granted on the verified owner_id match only;
        // a forged tenant header must not expose the unreviewed repair ledger.
        const { data: vehicleRow } = await supabase
          .from('vehicles')
          .select('owner_id')
          .eq('vin', vin)
          .maybeSingle();
        publicOnly = !(vehicleRow?.owner_id && vehicleRow.owner_id === ctx.id);
      }
    }
    const history = await getRepairHistory(vin, { publicOnly });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 5: OCR DOCUMENT EXTRACTION ---
app.post('/api/ai/ocr', authorizeRole(), async (req, res, next) => {
  const { docType, base64Data } = req.body;
  try {
    const parsedData = await runOcrParsing(docType, base64Data);
    res.json({ success: true, extractedData: parsedData });
  } catch (error) {
    next(error);
  }
});

// --- PILLAR 4: AI FRAUD & RISK SCANNERS ---
app.post('/api/ai/fraud-scan', authorizeRole(), async (req, res, next) => {
  const { vin, price, listingTitle } = req.body;
  try {
    const fraudScore = await runFraudAnalysis(vin, price, listingTitle);
    res.json(fraudScore);
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai/risk-assessment', authorizeRole(), async (req, res, next) => {
  const { vin, mileage, basePrice } = req.body;
  try {
    const riskReport = await runRiskScoring(vin, mileage, basePrice);
    res.json(riskReport);
  } catch (error) {
    next(error);
  }
});

// --- PILLAR 10: FINANCING pre-approval & affordability ---
app.post('/api/finance/pre-approve', authorizeRole(), async (req, res) => {
  const { vin, bankId, requestedAmount } = req.body;
  const userId = req.userContext.userId;
  try {
    // Tenant scope comes from the verified auth context (null = platform), never req.body.
    const result = await submitFinancingApplication(vin, userId, bankId, requestedAmount, req.userContext.tenantId ?? null);
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// --- PILLAR 11: INSURANCE QUOTES ---
app.post('/api/insurance/quote', async (req, res) => {
  const { vin, userId } = req.body;
  try {
    const result = await calculateInsuranceQuote(vin, userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 12: ZIMRA IMPORT TAX DUTY ESTIMATOR ---
app.post('/api/import/duty-estimate', (req, res) => {
  const { price, year, engineCc } = req.body;
  try {
    const result = calculateZimraDuty(price, year, engineCc);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 13: STOLEN ALERT SECURITY NETWORK ---
app.post('/api/security/report-stolen', authorizeRole(['owner', 'government']), async (req, res) => {
  const { vin, policeReportNumber, ownerId } = req.body;
  try {
    const result = await reportVehicleStolen(vin, policeReportNumber, ownerId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/security/check-stolen/:vin', async (req, res) => {
  const { vin } = req.params;
  try {
    const result = await checkStolenStatus(vin);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 14: DEALER REPUTATION ---
app.get('/api/reputation/:dealerId', async (req, res) => {
  const { dealerId } = req.params;
  try {
    const result = await calculateDealerReputation(dealerId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 19: AI RECOMMENDATIONS ---
app.get('/api/vehicles/:vin/recommendations', async (req, res) => {
  const { vin } = req.params;
  try {
    const result = await getSmartRecommendations(vin);
    // This route is public and unauthenticated. The recommendation service no longer orders by the
    // raw trust_score column — it selects through PUBLIC_VEHICLE_SELECT and orders by created_at —
    // so what remains for this route to do is state a trust position at all: the canonical
    // projection supplies it, and the ranking below is by that attributable score rather than by
    // the unversioned legacy number.
    const rows = Array.isArray(result) ? result : (result?.recommendations || result?.vehicles || []);
    const ranked = rankByCanonicalTrust(await withCanonicalTrust(rows));
    res.json(Array.isArray(result)
      ? ranked
      : { ...result, ...(result?.recommendations ? { recommendations: ranked } : { vehicles: ranked }) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 9: FLEET VEHICLE RESERVATIONS ---
// Authenticated buyers only; the buyer identity is the session identity — a
// client-supplied buyerId is ignored (previously any anonymous caller could
// mass-reserve the marketplace under an arbitrary id).
app.post('/api/vehicles/:vin/reserve', authorizeRole(), async (req, res) => {
  const { vin } = req.params;
  const { duration } = req.body;
  try {
    const result = await reserveVehicle(vin, req.userContext.id, duration);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- STAKEHOLDER PORTAL GOVERNANCE & MULTI-ORGANIZATIONAL LAYER ---

// Fetch logged in user's tenant profile and context
app.get('/api/organizations/my-org', authorizeRole(), async (req, res) => {
  const userId = req.userContext.id;
  const tenantId = req.userContext.tenantId; // If provided via headers
  
  try {
    let query = supabase
      .from('tenant_users')
      .select(`
        *,
        tenants!inner(id, name, type, status)
      `)
      .eq('user_id', userId);
      
    if (tenantId) query = query.eq('tenant_id', tenantId);
    
    const { data: tenantUsers, error: tenantUserError } = await query;
    
    if (tenantUserError || !tenantUsers || tenantUsers.length === 0) {
      return res.json({ success: false, message: 'No tenant organization found for this user context.' });
    }
    
    // Take the first active tenant mapped to this user
    const tenantUser = tenantUsers[0];
    const activeTenantId = tenantUser.tenant_id;
    
    // Parallel fetch tenant settings and branding
    const [settingsResult, brandingResult] = await Promise.all([
      supabase.from('tenant_settings').select('*').eq('tenant_id', activeTenantId).single(),
      supabase.from('tenant_branding').select('*').eq('tenant_id', activeTenantId).single()
    ]);

    res.json({
      success: true,
      organization: {
        id: activeTenantId,
        name: tenantUser.tenants.name,
        type: tenantUser.tenants.type,
        status: tenantUser.tenants.status
      },
      member: {
        role: tenantUser.role,
        joinedAt: tenantUser.joined_at
      },
      settings: settingsResult.data || {},
      branding: brandingResult.data || {}
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch organization branches
app.get('/api/organizations/:id/branches', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: branches, error } = await supabase
      .from('organization_branches')
      .select('*')
      .eq('organization_id', id);
    if (error) throw error;
    res.json(branches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch staff / users inside organization
app.get('/api/organizations/:id/users', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: users, error } = await supabase
      .from('organization_users')
      .select(`
        *,
        users!inner(name, email, avatar),
        organization_roles!inner(name, level)
      `)
      .eq('organization_id', id);
    if (error) throw error;
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch audit logs inside organization
app.get('/api/organizations/:id/audit-logs', authorizeRole(), async (req, res, next) => {
  const { id } = req.params;
  try {
    // Organization scope / admin verification
    if (req.userContext.role !== 'admin') {
      const { data: org } = await supabase
        .from('organizations')
        .select('tenant_id')
        .eq('id', id)
        .single();
        
      if (!org || !org.tenant_id) {
        throw new ForbiddenError('Forbidden. Organization not found or not mapped.');
      }
      
      const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('tenant_id')
        .eq('user_id', req.userContext.id)
        .eq('tenant_id', org.tenant_id)
        .single();
        
      if (!tenantUser) {
        throw new ForbiddenError('Forbidden. You do not belong to this organization.');
      }
    }

    const { data: logs, error } = await supabase
      .from('organization_audit_logs')
      .select('*')
      .eq('organization_id', id)
      .order('id', { ascending: false });
    if (error) throw error;
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

// Post audit log
app.post('/api/organizations/:id/audit-logs', authorizeRole(), async (req, res, next) => {
  const { id } = req.params;
  const { userId, action, resource, details } = req.body;
  try {
    // 1. Organization scope / admin verification
    if (req.userContext.role !== 'admin') {
      const { data: org } = await supabase
        .from('organizations')
        .select('tenant_id')
        .eq('id', id)
        .single();
        
      if (!org || !org.tenant_id) {
        throw new ForbiddenError('Forbidden. Organization not found or not mapped.');
      }
      
      const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('tenant_id')
        .eq('user_id', req.userContext.id)
        .eq('tenant_id', org.tenant_id)
        .single();
        
      if (!tenantUser) {
        throw new ForbiddenError('Forbidden. You do not belong to this organization.');
      }
    }

    // 2. Identity mismatch check
    const targetUserId = userId || req.userContext.id;
    if (req.userContext.role !== 'admin' && targetUserId !== req.userContext.id) {
      throw new ForbiddenError('Forbidden. You cannot log audit events for another user.');
    }

    const timestamp = new Date().toISOString();
    const { error } = await supabase.from('organization_audit_logs').insert({
      organization_id: id,
      user_id: targetUserId,
      action,
      resource,
      details,
      timestamp,
      ip_address: req.ip || '127.0.0.1'
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// --- FINANCE APPLICATIONS MOVED TO MODULAR ROUTER ---

// --- AUTH: Login ---
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, phone, role, password_hash')
      .eq('email', email)
      .single();

    if (error || !user) {
      await supabase.from('login_attempts').insert({ success: false, method: 'password', ip_address: req.ip || '127.0.0.1' });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const credentials = await evaluateLoginCredentials({ user, password });
    if (!credentials.ok) {
      await supabase.from('login_attempts').insert({ user_id: user.id, success: false, method: 'password', ip_address: req.ip || '127.0.0.1' });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    delete user.password_hash;

    // Generate actual session token in the database (No more mocks)
    const token = 'sk_live_' + crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    
    const { error: sessionError } = await supabase.from('user_sessions').insert(
      buildSessionRow({ userId: user.id, activeRole: user.role, token, expiresAt: expiresAt.toISOString(), req })
    );
    // Fail loudly: never hand back a token we could not persist (it would 401 on the next request).
    if (sessionError) {
      console.error('Failed to persist user session on login:', sessionError.message);
      return res.status(500).json({ error: 'Could not establish a session. Please try again.' });
    }

    await supabase.from('login_attempts').insert({ user_id: user.id, success: true, method: 'password', ip_address: req.ip || '127.0.0.1' });

    res.json({ user, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- AUTH: Validate current session ---
// authorizeRole() (no required roles) validates the x-session-token against user_sessions and
// returns the authoritative user. The frontend calls this on boot to detect stale/expired tokens;
// an invalid/expired token yields 401 "Unauthorized. Session is invalid or expired." (unchanged auth).
app.get('/api/auth/me', authorizeRole(), async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, phone, role')
      .eq('id', req.userContext.id)
      .single();
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized. User record not found.' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// The only role an unauthenticated public registration may create. Privileged roles
// (admin/government/bank/insurance/dealer/mechanic) are granted only through governed,
// authenticated paths — never the public register route.
const PUBLIC_REGISTRATION_ROLE = 'owner';

// --- AUTH: Register ---
// Public registration is UNAUTHENTICATED, so it must NEVER honor a client-supplied platform role.
// The server always assigns the unprivileged PUBLIC_REGISTRATION_ROLE ('owner'); any request that
// asks for a different role — privileged (admin/government/bank/insurance/dealer/mechanic) or
// unknown — is rejected BEFORE any user or session row is created. Allowlist, not denylist, so a
// future privileged role can never slip through. This closes the self-register-as-admin escalation.
app.post('/api/auth/register', async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

  // Fail closed: only an omitted/empty role or an explicit 'owner' is accepted; everything else is
  // rejected here, before the existence read or any write — so a rejected request creates nothing.
  const requestedRole = role === undefined || role === null ? '' : String(role).trim().toLowerCase();
  if (requestedRole !== '' && requestedRole !== PUBLIC_REGISTRATION_ROLE) {
    return res.status(403).json({ error: "Public registration cannot assign a role; accounts are created as 'owner'." });
  }
  const assignedRole = PUBLIC_REGISTRATION_ROLE; // server-controlled — never derived from the request

  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const password_hash = password ? await hashPassword(password) : null;

    const id = 'u_' + crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    const { error } = await supabase.from('users').insert({
      id, name, email, phone: phone || '', role: assignedRole, password_hash, join_date: new Date().toISOString()
    });

    if (error) throw error;

    // Automatically issue a session
    const token = 'sk_live_' + crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const { error: sessionError } = await supabase.from('user_sessions').insert(
      buildSessionRow({ userId: id, activeRole: assignedRole, token, expiresAt: expiresAt.toISOString(), req })
    );
    // Fail loudly: never hand back a token we could not persist (it would 401 on the next request).
    if (sessionError) {
      console.error('Failed to persist user session on register:', sessionError.message);
      return res.status(500).json({ error: 'Account created, but a session could not be established. Please log in.' });
    }

    const newUser = { id, name, email, phone: phone || '', role: assignedRole };
    res.json({ user: newUser, token });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

/**
 * ISSUE #164 PHASE 4 — WHAT A SUBMITTED VALUE IS ALLOWED TO BECOME.
 *
 * An empty or whitespace-only field is not a fact the seller stated; it is a field they left alone.
 * Storing `''` puts something in the column that no later read can tell apart from a real value, so
 * unknown has to stay unknown on the way IN as well — a fabricated blank is inherited by every
 * surface downstream and no state on the read side can undo it.
 */
function submittedText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * WHO asserted the values on this submission, drawn from CLAIM_SOURCES.
 *
 * The read path publishes a location, a registration country or a seller type ONLY when a companion
 * `*_source` column names its origin, and the database refuses a location column that carries no
 * source at all. A source describes the origin, not our confidence: a seller filling in their own
 * listing is `seller_declared` however true it later proves to be. Strength of evidence is the Trust
 * contract's business (canonicalTrustService) and is deliberately not restated here.
 */
function submittedClaimSource(userContext = {}) {
  const role = String(userContext.role ?? userContext.effectiveRole ?? '').trim().toLowerCase();
  if (role === 'dealer') return 'dealer_declared';
  if (role === 'owner') return 'seller_declared';
  // An admin creating a listing on someone's behalf is the operator, not the seller.
  return 'operator_recorded';
}

/**
 * Provenance for `current_seller_type`, or null.
 *
 * `buildVehicleListingCandidate` sets the seller type from the authenticated ROLE — an owner account
 * listing their own car is a private sale, a dealer account listing one is a dealer sale — and that
 * is somebody asserting it, so it earns a source. Its remaining branch DERIVES the type from whether
 * `owner_id` or `tenant_id` happens to be set, which is an inference about the row rather than a
 * statement by anyone; stamping a source on that would turn the defect into a claim. Unstamped, the
 * value still lands in the column and is simply never published.
 */
function declaredSellerTypeSource(userContext = {}, body = {}) {
  const role = String(userContext.role ?? userContext.effectiveRole ?? '').trim().toLowerCase();
  if (role === 'dealer' || role === 'owner') return submittedClaimSource(userContext);
  return submittedText(body.current_seller_type) === null ? null : 'operator_recorded';
}

/**
 * True when a write failed because the listing-claim columns are not on the table yet.
 *
 * 20260818110000_issue164_listing_location_provenance.sql is authored but UNAPPLIED, and PostgREST
 * rejects an insert naming a column it cannot find (PGRST204 from the schema cache, 42703 from
 * PostgreSQL itself). Without this guard, adding the columns to the payload would 500 every listing
 * submission until the migration lands. Same shape as the `approved_by` fallback in
 * listingSummaryService — and the response says the location was not recorded rather than going
 * quiet about it, because accepting a value and then silently dropping it is the defect being closed.
 */
function isMissingListingClaimColumnError(error) {
  const code = String(error?.code ?? '').toUpperCase();
  if (code === 'PGRST204' || code === '42703') return true;
  // The name-based fallback is deliberately conjoined with a "missing" phrase. On its own it would
  // also match a CHECK violation, whose constraint names embed these column names — and treating a
  // vocabulary violation as "the schema is old" would drop the location and report success, hiding
  // a bug in this file behind the migration. A constraint violation must surface as one.
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
  const saysMissing = text.includes('could not find') || text.includes('does not exist') || text.includes('schema cache');
  return saysMissing && LISTING_CLAIM_COLUMNS.some((column) => text.includes(column));
}

// --- VEHICLE LISTING: Create new listing (saves as draft) ---
app.post('/api/vehicles/add', authorizeRole(['dealer', 'owner', 'admin']), async (req, res) => {
  // STILL ACCEPTED AND STILL NOT STORED — named here rather than left as an unused destructure that
  // reads like an oversight: `condition`, `category` and `description` reach no column from this
  // handler. `vehicle_condition_category` is owned by the classification contract
  // (marketplaceClassificationRules and its admin-approved backfill), so letting a seller
  // self-declare it through this endpoint would route around that approval. Open finding, not
  // closed by inventing a write here.
  const {
    vin, make, model, color, mileage, fuel_type, transmission,
    price, currency, location, province, images,
    // Phase 4 identity fields
    engine_number, chassis_number, plate_number, temp_plate_id, import_status,
  } = req.body;
  if (!vin || !make || !model || !price) return res.status(400).json({ error: 'VIN, make, model, and price are required' });

  // `mileage` is NOT NULL on public.vehicles with no default, so the column cannot hold "not known"
  // and `mileage || 0` resolved that by writing 0 km as a fact — a reading a shopper cannot tell
  // from a genuine delivery-mileage vehicle. Where a column cannot record unknown, the honest
  // resolution is to refuse the write rather than to invent the value.
  const submittedMileage = Number(submittedText(mileage));
  if (submittedText(mileage) === null || !Number.isFinite(submittedMileage) || submittedMileage < 0) {
    return res.status(400).json({ error: 'mileage is required and must be a non-negative number: vehicles.mileage cannot record an unknown odometer reading' });
  }
  // A number with no currency is not a price. `currency || 'USD'` stated a currency the seller never
  // did, in a market that actively trades in more than one.
  const submittedCurrency = submittedText(currency);
  if (submittedCurrency === null) {
    return res.status(400).json({ error: 'currency is required alongside price' });
  }

  // ── LISTING MEDIA, READ OFF THE REQUEST BEFORE ANYTHING IS WRITTEN ──────────────────────────
  // Two accepted forms, and the difference between them is the whole of Rule 6:
  //
  //   'https://…'                        a URL and NOTHING ELSE. It expresses NO primacy.
  //   { url: 'https://…', is_primary: true }   a seller who actually chose their main photo.
  //
  // A bare string is what every real client sends today — `SellVehicle.tsx` builds
  // `uploadedImageUrls: string[]` from the upload endpoint and the form carries no "main photo"
  // control at all — so on today's traffic NOTHING claims primacy, which is the correct reading of
  // a form that never asked. Only `is_primary === true` is a claim; a missing, false or truthy-ish
  // key is an absence, so primacy can never be acquired by accident.
  const submittedMedia = (Array.isArray(images) ? images : []).map((entry) => {
    const isObject = entry !== null && typeof entry === 'object' && !Array.isArray(entry);
    return {
      url: isObject ? entry.url : entry,
      claimsPrimary: isObject ? entry.is_primary === true : false,
    };
  });
  // TWO PRIMARIES IS NOT A CHOICE, IT IS A CONTRADICTION, and it is refused BEFORE the vehicle row
  // is inserted so the caller gets a clean 400 rather than a half-made listing. Electing one of
  // them here would be the same fabrication as `idx === 0`, just with more steps: the projection
  // demotes extra claimants on the way OUT because it must cope with rows it did not write, which
  // is not a licence for this handler to author the ambiguity in the first place. Same resolution
  // the odometer and the currency get above — refuse the write rather than invent the value.
  if (submittedMedia.filter((entry) => entry.claimsPrimary).length > 1) {
    return res.status(400).json({
      error: 'Only one image may be marked is_primary: a listing has at most one seller-chosen main photo',
    });
  }

  // Real-listing eligibility: build the exact candidate row from auth context + body, then validate so
  // fixture/demo/incomplete data cannot enter the public Marketplace (see marketplaceListingEligibility).
  const candidate = buildVehicleListingCandidate({ body: req.body, userContext: req.userContext });
  const eligibility = getListingEligibility(candidate);
  if (!eligibility.eligible) {
    return res.status(400).json({ error: 'Listing is not marketplace-eligible', reasons: eligibility.reasons });
  }

  // THE WRITE-SIDE ROOT CAUSE, CLOSED. `location` and `province` were destructured out of the body
  // and then referenced nowhere: the seller typed where the car is, the server accepted it, dropped
  // it, and the marketplace card printed a country literal in the space where it should have been.
  // The card was not reading a stale column — there was no location column at all, because the write
  // path had nowhere to put what the seller had just typed.
  const claimSource = submittedClaimSource(req.userContext);
  const listingCity = submittedText(location);
  const listingProvince = submittedText(province);
  // Never inferred from `registration_country` or from the seller's profile: where a car is
  // registered is not where it is, and where its seller lives is not where it is. The form does not
  // collect a country today, so the country stays unrecorded while the city is recorded — which is
  // exactly the state the read contract exists to be able to express.
  const listingCountry = submittedText(req.body.listing_country ?? req.body.country);
  const hasListingLocation = listingCity !== null || listingProvince !== null || listingCountry !== null;
  // The location was typed into the public listing form for the express purpose of appearing on the
  // listing, so a submission that says nothing about visibility records it as published. Anything
  // other than an explicit 'public' withholds — an out-of-vocabulary value is not a consent decision
  // that can be read, and absence of consent is not consent. Adding a control to the form is what
  // would make this a seller's choice rather than a default.
  const submittedVisibility = submittedText(req.body.location_visibility);
  const listingVisibility = submittedVisibility === null || submittedVisibility === CLAIM_VISIBILITY.PUBLIC
    ? CLAIM_VISIBILITY.PUBLIC
    : CLAIM_VISIBILITY.WITHHELD;

  const listingClaimColumns = {
    // No location fact without provenance — the read path refuses to publish one, and after the
    // migration the database refuses to store one.
    ...(hasListingLocation ? {
      listing_city: listingCity,
      listing_province: listingProvince,
      listing_country: listingCountry,
      listing_location_source: claimSource,
      listing_location_visibility: listingVisibility,
      listing_location_recorded_at: new Date().toISOString(),
    } : {}),
    // Provenance ONLY for what this submission actually asserted. `buildVehicleListingCandidate` no
    // longer substitutes 'ZW' for an absent registration country — the candidate carries an explicit
    // NULL, so there is nothing left to accidentally stamp — and this stays gated on the SUBMITTED
    // text rather than on the candidate, because a source names who said it and the candidate is not
    // a speaker. The two halves now agree: no value, no source, nothing published.
    registration_country_source: submittedText(req.body.registration_country) === null ? null : claimSource,
    current_seller_type_source: declaredSellerTypeSource(req.userContext, req.body),
    // The attesting half of the currency pair. `submittedCurrency` is REQUIRED above (400 without
    // it) and stored verbatim, so a currency on a row this handler wrote was genuinely stated by
    // this submitter — unconditionally, which is why there is no null branch here as there is for
    // the registration country. Without this stamp the read paths (listingSummaryService.currencyClaim,
    // marketplacePricingService, and buildVehiclePassport's gate above) would refuse to publish a
    // currency the seller really did declare: the migration drops the fabricating DEFAULT, and this
    // is what stops that leaving every price permanently currency-less. Under-reporting is the
    // gentler failure mode of the two, but it is still one.
    currency_source: claimSource,
  };

  try {
    const { data: existing } = await supabase.from('vehicles').select('vin').eq('vin', vin).single();
    if (existing) return res.status(409).json({ error: 'A vehicle with this VIN is already listed' });

    const listingRow = {
      vin: candidate.vin, make: candidate.make, model: candidate.model,
      // `''` is a recorded blank, not an unrecorded field. Neither generation nor trim is collected
      // by this endpoint, so both are unknown and are stored as unknown.
      generation: null, trim: null,
      year: candidate.year,
      // NO SUBSTITUTES FOR A SPECIFICATION THE SELLER DID NOT GIVE. 'White', 'Petrol', 'Automatic'
      // and a hardcoded 'RWD' were written for every client that omitted them, which is how a
      // specification value ends up `recorded` and still an invention — the one defect the read
      // contract cannot fix from its side, because these columns carry no provenance to gate on.
      // It is closed by removing the substitution, not by weakening a state on the way out.
      color: submittedText(color),
      mileage: submittedMileage,
      fuel_type: submittedText(fuel_type),
      drivetrain: submittedText(req.body.drivetrain),
      transmission: submittedText(transmission),
      // `|| 'local'` was the last substitution on this row: a seller who said nothing about import
      // had 'local' written for them, and the marketplace then read it back as a stated fact. The
      // column is NULLABLE with no DB default, so an unstated import source is simply NULL — and
      // unlike the registration country there is no default waiting to fill the gap, so omitting
      // the key would work too; it is written explicitly to say so on purpose.
      import_source: import_status === 'imported' ? 'import' : candidate.import_source,
      duty_paid: false, police_verified: false,
      // A brand-new listing has NOT been evaluated, so it is stamped with no score. The explicit
      // null matters: public.vehicles.trust_score DEFAULTS TO 80.0, so omitting the column would
      // hand every new listing a fabricated 80 — worse than the 50 this used to write. Only
      // canonicalTrustService.refreshCanonicalTrust may put a number in this column, and only
      // together with the calculation_version that makes it publishable (INV-TRUST-2).
      status: normalizeVehicleStatus(candidate.status), trust_score: null, price: candidate.price,
      currency: submittedCurrency,
      owner_id: candidate.owner_id,
      tenant_id: candidate.tenant_id,
      current_seller_type: candidate.current_seller_type,
      registration_country: candidate.registration_country,
      // Phase 4: identity fields — stored for completeness gate evaluation
      engine_number: submittedText(engine_number),
      chassis_number: submittedText(chassis_number),
      plate_number: submittedText(plate_number),
      temp_plate_id: submittedText(temp_plate_id),
      // All vehicles start as draft; must upload and verify documents to reach 'publishable'
      publication_status: 'draft',
    };

    let listingClaimsRecorded = true;
    let { error: insertError } = await supabase.from('vehicles').insert({ ...listingRow, ...listingClaimColumns });
    if (insertError && isMissingListingClaimColumnError(insertError)) {
      // The migration has not been applied yet. A single-row PostgREST insert is atomic, so the
      // rejected attempt wrote nothing; create the listing without the claim columns and report on
      // the response that the location was not recorded.
      console.warn(`Listing claim columns unavailable (migration 20260818110000 not applied); location not recorded for ${candidate.vin}.`);
      listingClaimsRecorded = false;
      ({ error: insertError } = await supabase.from('vehicles').insert(listingRow));
    }
    if (insertError) throw insertError;

    if (req.userContext.id) {
      await supabase.from('vehicle_ownership_history').insert({
        vin, new_owner_id: req.userContext.id, transfer_date: new Date().toISOString(), transfer_hash: 'INITIAL'
      });
    }

    // ── PERSIST LISTING MEDIA, WITHOUT AUTHORING ANYTHING THE SELLER DID NOT SAY ──────────────
    //
    // THE UNPUBLISHABLE URL IS REFUSED AT THE DOOR, ONCE. `image_url: url` stored the request body
    // verbatim — no scheme check, no length check, nothing — which is the source of every value the
    // read contract then has to refuse forever. Measured against the shipped handler before this
    // change: a submission of five images stored `javascript:alert(document.cookie)`,
    // `data:image/png;base64,…`, a whitespace-only string and a path-relative `photo.jpg` into the
    // column, four rows the projection can never publish; and the `idx === 0` line below stored the
    // `javascript:` one AS THE SELLER'S MAIN PHOTO. `isPublishableMediaUrl` is imported from the
    // projection rather than restated, so there is ONE definition of publishable in the codebase and
    // the writer cannot drift away from the reader.
    //
    // REFUSED AND COUNTED, NOT REJECTED WHOLESALE. A bad photo URL does not void a real listing —
    // the publishable images are stored and the rest are reported on the response, which is Rule 5's
    // `unpublishable_count` idiom applied one layer up. Silently discarding them is what this phase
    // exists to close; 400-ing the whole listing would discard the vehicle too.
    const publishableMedia = submittedMedia.filter((entry) => isPublishableMediaUrl(entry.url));
    const imagesUnpublishableCount = submittedMedia.length - publishableMedia.length;
    const imageRecords = publishableMedia.map((entry, idx) => ({
      vin,
      image_url: String(entry.url).trim(),
      // RULE 6, AT THE LAYER THAT WAS BREAKING IT. `is_primary: idx === 0` fabricated the seller's
      // main-photo choice out of ARRAY ORDER and persisted it in a column no reader can distinguish
      // from a real choice — so `primary_image_state: 'seller_primary'`, which Phase 5 publishes
      // precisely to say "the seller chose this one", was untruthful for every listing this route
      // ever created. Absence is now recorded as absence: with nothing claimed, no row claims, and
      // the read path reports `first_published` — the honest label for "this is merely the first
      // photo in display order". The DISPLAYED photo is unchanged, because the projection sorts
      // primary-claimants first and then by `display_order`, and image 0 still carries
      // `display_order: 0`; only the LABEL on it stops lying.
      is_primary: entry.claimsPrimary,
      // Dense over the PUBLISHABLE set, so a refused URL leaves no gap in the running order.
      display_order: idx,
    }));

    // WHAT WAS ACTUALLY STORED, TRACKED. `location_recorded` eleven lines below is the pattern this
    // follows; it is not a new idiom invented here.
    let imagesRecorded = false;
    let imagesRecordedCount = 0;
    if (imageRecords.length > 0) {
      const { error: imageError } = await supabase.from('listing_images').insert(imageRecords);
      if (imageError) {
        // Still logged for operators — but the log is no longer the ONLY place the failure exists.
        console.error('⚠️ Failed to save listing images:', imageError.message);
      } else {
        imagesRecorded = true;
        imagesRecordedCount = imageRecords.length;
      }
    }

    const locationRecorded = hasListingLocation && listingClaimsRecorded;
    res.status(201).json({
      success: true,
      vin,
      publication_status: 'draft',
      // WHAT WAS ACTUALLY RECORDED, STATED. A submitted location that could not be stored reports
      // `location_recorded: false` here, so the caller learns it at the moment it happened instead
      // of discovering it later as a blank card — the silent discard is what this phase closes.
      location_recorded: locationRecorded,
      location_visibility: locationRecorded ? listingVisibility : null,
      // AND THE SAME FOR THE PHOTOS. A failed `listing_images` insert was console.error'd and the
      // route returned `success: true` anyway — measured on the shipped handler: zero rows stored,
      // 201, and not one key in the body mentioning photographs. The seller was told their listing
      // was saved and reasonably understood that to include the pictures they had just uploaded.
      //
      // Four separate facts, none derivable from another, which is why there are four keys and not
      // one summary:
      //   `images_recorded`             did ANY image reach the table. False when none were
      //                                 submitted and false when the insert failed — both are
      //                                 truthfully "we recorded no photos", exactly as
      //                                 `location_recorded` treats the same pair.
      //   `images_recorded_count`       how many rows were written, so "I sent 5, you stored 1" is
      //                                 legible to the caller at the moment it happens.
      //   `images_unpublishable_count`  how many submitted values this contract will not publish.
      //                                 Without it a refused URL is a silent discard, which is the
      //                                 defect one layer down.
      //   `images_primary_recorded`     whether a seller-EXPRESSED primacy actually reached a stored
      //                                 row. A seller who chose a main photo whose URL was then
      //                                 refused must not be left believing the choice took effect,
      //                                 and no other key here can tell them.
      images_recorded: imagesRecorded,
      images_recorded_count: imagesRecordedCount,
      images_unpublishable_count: imagesUnpublishableCount,
      images_primary_recorded: imagesRecorded && imageRecords.some((record) => record.is_primary === true),
      message: 'Vehicle saved as draft. Upload ownership documents to advance toward publication.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- VEHICLE COMPLETENESS: Publication readiness evaluation ---
// Scope rule mirrors loadScopedVehicle (vehiclesRoutes): the requirement matrix
// exposes identity-document state, so a non-admin/non-reviewer may only read a
// VIN they own or that belongs to their tenant.
app.get('/api/vehicles/:vin/completeness', authorizeRole(['owner', 'dealer', 'admin', 'reviewer']), async (req, res) => {
  const { vin } = req.params;
  try {
    if (req.userContext.role !== 'admin' && req.userContext.role !== 'reviewer') {
      const { data: vehicleRow, error: vehicleErr } = await supabase
        .from('vehicles')
        .select('owner_id, tenant_id')
        .eq('vin', vin)
        .maybeSingle();
      if (vehicleErr) return res.status(500).json({ error: 'Vehicle ownership lookup failed.' });
      if (!vehicleRow) return res.status(404).json({ error: `Vehicle not found: ${vin}` });
      const ownsVehicle = vehicleRow.owner_id && vehicleRow.owner_id === req.userContext.id;
      const sameTenant = vehicleRow.tenant_id && vehicleRow.tenant_id === req.userContext.tenantId;
      if (!ownsVehicle && !sameTenant) {
        return res.status(403).json({ error: 'Forbidden. You do not have ownership or organizational scope over this vehicle.' });
      }
    }
    const result = await evaluateCompleteness(vin);
    res.json(result);
  } catch (err) {
    if (err.message.startsWith('Vehicle not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// --- DEALER: Fetch Inventory ---
app.get('/api/vehicles/inventory', authorizeRole(['dealer', 'admin']), async (req, res) => {
  try {
    const tenantId = req.userContext.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'No active tenant selected.' });
    }
    
    const { data: inventory, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// DOMAIN 1: DEALER & MECHANIC ENDPOINTS
// ==========================================

// --- DEALER & MECHANIC ENDPOINTS MOVED TO MODULAR ROUTERS ---

// --- VEHICLE STATUS UPDATE MOVED TO MODULAR ROUTER ---

// --- DOMAIN 2: BANK & INSURANCE ENDPOINTS ---

app.get('/api/telemetry', authorizeRole(['bank', 'insurance', 'government', 'admin']), async (req, res) => {
  try {
    const { data: telemetry, error } = await supabase
      .from('vehicle_telemetry')
      .select('*')
      .order('timestamp', { ascending: false });
    if (error) throw error;
    res.json(telemetry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- INSURANCE CLAIMS ENDPOINTS MOVED TO modular ROUTERS ---

app.get('/api/security/fraud-alerts', authorizeRole(['insurance', 'government', 'admin']), async (req, res) => {
  try {
    const { data: alerts, error } = await supabase
      .from('fraud_alerts')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/security/fraud-alerts/:id/resolve', authorizeRole(['admin', 'insurance', 'government']), async (req, res) => {
  const { id } = req.params;
  try {
    const { data: alert, error } = await supabase
      .from('fraud_alerts')
      .update({ status: 'Resolved', resolved_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- DOMAIN 3: GOVERNMENT & ADMIN ENDPOINTS ---

app.get('/api/compliance/reports', authorizeRole(['government', 'admin']), async (req, res) => {
  try {
    const { data: reports, error } = await supabase
      .from('compliance_reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- COMPLIANCE REGISTRY VERIFICATIONS MOVED TO MODULAR ROUTER ---

// --- ADMIN TELEMETRY & USER SERVICES MOVED TO MODULAR ROUTER ---

function renderPublicLegalPage({ title, description, sections }) {
  const sectionHtml = sections.map((section) => `
    <section>
      <h2>${section.heading}</h2>
      <p>${section.body}</p>
    </section>
  `).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | CarUp</title>
  <meta name="description" content="${description}">
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #0f172a; }
    header { background: #020617; color: white; padding: 56px 24px; }
    main { max-width: 920px; margin: 0 auto; padding: 40px 24px 64px; }
    .wrap { max-width: 920px; margin: 0 auto; }
    .eyebrow { color: #fed7aa; font-size: 14px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { font-size: clamp(32px, 6vw, 56px); line-height: 1; margin: 16px 0; }
    h2 { font-size: 22px; margin: 0 0 10px; }
    p { font-size: 16px; line-height: 1.7; color: #475569; margin: 0; }
    header p { color: #cbd5e1; max-width: 720px; }
    section { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; margin: 18px 0; box-shadow: 0 1px 2px rgba(15, 23, 42, .04); }
    a { color: #c2410c; font-weight: 700; }
    footer { border-top: 1px solid #e2e8f0; color: #64748b; padding: 24px; text-align: center; }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="eyebrow">CarUp Legal</div>
      <h1>${title}</h1>
      <p>${description}</p>
    </div>
  </header>
  <main>${sectionHtml}</main>
  <footer>CarUp Automotive Intelligence Private Limited - legal@carup.co.zw</footer>
</body>
</html>`;
}

app.get('/privacy-policy', (_req, res) => {
  res.type('html').set('Cache-Control', 'public, max-age=300').send(renderPublicLegalPage({
    title: 'Privacy Policy',
    description: 'CarUp explains how we collect, use, protect, and process account, marketplace, vehicle, communication, and support data.',
    sections: [
      {
        heading: 'Data We Collect',
        body: 'CarUp may collect account details, contact information, vehicle listing information, verification evidence, communication records, support requests, and technical metadata needed to operate the platform.',
      },
      {
        heading: 'How We Use Data',
        body: 'We use data to provide marketplace services, vehicle trust and verification tools, SafePay workflows, customer support, communication delivery, fraud prevention, compliance, and platform security.',
      },
      {
        heading: 'Sharing and Protection',
        body: 'We do not sell personal data. We share limited data only with service providers, regulators, payment or verification partners, or other parties when required to operate the service, protect users, or comply with law.',
      },
      {
        heading: 'Your Choices',
        body: 'Users can request access, correction, or deletion of eligible personal data by contacting privacy@carup.co.zw or legal@carup.co.zw. See the User Data Deletion page for deletion instructions.',
      },
    ],
  }));
});

app.get('/terms', (_req, res) => {
  res.type('html').set('Cache-Control', 'public, max-age=300').send(renderPublicLegalPage({
    title: 'Terms of Service',
    description: 'These terms govern access to and use of the CarUp platform, including marketplace, vehicle verification, communication, and trust services.',
    sections: [
      {
        heading: 'Use of the Platform',
        body: 'Users must provide accurate information, follow marketplace and verification rules, and avoid fraudulent, unsafe, unlawful, or misleading activity.',
      },
      {
        heading: 'Vehicle and Transaction Information',
        body: 'CarUp provides trust, verification, marketplace, and communication tools. Users remain responsible for reviewing listings, documents, legal requirements, and transaction terms before acting.',
      },
      {
        heading: 'Accounts and Communications',
        body: 'By using CarUp, users may receive operational messages through supported channels such as WhatsApp, email, or in-app notifications where allowed by law and user preferences.',
      },
      {
        heading: 'Contact',
        body: 'Questions about these terms can be sent to legal@carup.co.zw or support@carup.co.zw.',
      },
    ],
  }));
});

app.get('/data-deletion', (_req, res) => {
  res.type('html').set('Cache-Control', 'public, max-age=300').send(renderPublicLegalPage({
    title: 'User Data Deletion Instructions',
    description: 'CarUp users can request deletion or anonymization of eligible personal data connected to their account and communications.',
    sections: [
      {
        heading: 'How to Request Deletion',
        body: 'Email privacy@carup.co.zw or legal@carup.co.zw with the subject "Data Deletion Request" and include your account email, phone number, or communication channel so we can verify ownership.',
      },
      {
        heading: 'What We Delete',
        body: 'After verification, we delete or anonymize eligible account details, contact identifiers, communication identifiers, profile data, and support records where deletion is legally and technically permitted.',
      },
      {
        heading: 'What May Be Retained',
        body: 'Some audit, payment, fraud-prevention, vehicle-history, safety, compliance, and legal records may be retained in minimized or anonymized form when needed for platform integrity or legal obligations.',
      },
      {
        heading: 'Timing',
        body: 'We aim to acknowledge deletion requests within 7 business days and complete eligible deletion or anonymization actions within 30 days unless a legal, safety, or security exception applies.',
      },
    ],
  }));
});

// ✅ Root welcome endpoint to prevent 'Cannot GET /'
app.get('/', (req, res) => {
  res.json({
    name: 'CarUp OS API Gateway',
    version: '1.0.0',
    description: 'Zimbabwe\'s AI-native Automotive Trust Operating System Gateway',
    status: 'online',
    documentation: '/api/health'
  });
});

// ✅ Silence favicon.ico 404 errors in browser consoles
app.get('/favicon.ico', (req, res) => res.status(204).end());


// ============================================================================
// PHASE 5: OWNER OS (Consumer OS)
// ============================================================================

// GET /api/vehicles/me - Get vehicles owned by the current user
app.get('/api/vehicles/me', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('owner_id', req.userContext.id)

    if (error) throw error
    // An owner is shown their vehicle's trust position through the same authority as everyone else.
    // The raw column here is what the owner dashboard rendered as "Trust Index %", which is the
    // unattributable number in its most persuasive form: shown to the person who will repeat it.
    const withTrust = await withCanonicalTrust(data)
    // Garage counts come from real reads, so My Garage stops publishing `|| 0` against columns that
    // do not exist. `null` means "not read", and the surface must say so in words.
    const counts = await ownerGarageCounts(withTrust.map((vehicle) => vehicle.vin))
    // The owner's own photographs, from the same table and the same projection the public listing
    // uses. Without this the owner list surfaces have no media field to read at all and every card
    // falls back to the "Image unavailable" placeholder — see ownerListingMedia.
    const media = await ownerListingMedia(withTrust.map((vehicle) => vehicle.vin))
    res.json(withTrust.map((vehicle) => ({
      ...vehicle,
      counts: counts.get(vehicle.vin) ?? null,
      listing_media: media.get(vehicle.vin) ?? toListingMediaBlock(null),
    })))
  } catch (error) {
    console.error('Error fetching owned vehicles:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /api/vehicles/saved - Get vehicles saved by the current user
app.get('/api/vehicles/saved', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  try {
    // Saved vehicles belong to OTHER sellers — embed only the sanitized public
    // projection, never the raw star embed (engine/chassis/plate/owner_id leak).
    const { data, error } = await supabase
      .from('saved_vehicles')
      .select(`*, vehicles(${PUBLIC_VEHICLE_COLUMNS})`)
      .eq('user_id', req.userContext.id)

    if (error) throw error
    // Saved cards render a trust figure like any other listing, so they get the canonical
    // projection too — the embedded row's stored trust_score is never published.
    res.json(await withCanonicalTrust((data || []).map(sv => sv.vehicles)))
  } catch (error) {
    console.error('Error fetching saved vehicles:', error)
    res.status(500).json({ error: error.message })
  }
})

// POST /api/vehicles/saved/add - Save a vehicle
app.post('/api/vehicles/saved/add', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  try {
    const { vin } = req.body
    if (!vin) return res.status(400).json({ error: 'vin is required' })

    const { data, error } = await supabase
      .from('saved_vehicles')
      .upsert({ user_id: req.userContext.id, vin }, { onConflict: 'user_id,vin' })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    console.error('Error saving vehicle:', error)
    res.status(500).json({ error: error.message })
  }
})


// DELETE /api/vehicles/saved/:vin - Remove a saved vehicle
app.delete('/api/vehicles/saved/:vin', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  try {
    const { vin } = req.params
    const { error } = await supabase
      .from('saved_vehicles')
      .delete()
      .eq('user_id', req.userContext.id)
      .eq('vin', vin)

    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    console.error('Error removing saved vehicle:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /api/service-history/me - Get service history for owned vehicles
//
// Service Network S6: this used to return raw mechanic_work_orders rows, which left the
// owner surface with no provider identity, no provenance and no currency — so the UI
// printed the literal word "Garage" and rendered an unrecorded cost as $0. It now returns
// the governed owner projection, which states a fact or reports it as absent. The original
// row fields are preserved so existing consumers keep working.
app.get('/api/service-history/me', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  try {
    const result = await getOwnerServiceHistory(supabase, req.userContext)
    res.json(result.entries)
  } catch (error) {
    console.error('Error fetching service history:', error)
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

// GET /api/notifications/me - Get user notifications
app.get('/api/notifications/me', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notification_queue')
      .select('*')
      .eq('recipient_id', req.userContext.id)
      .order('created_at', { ascending: false })

    if (error) throw error
    res.json(data || [])
  } catch (error) {
    console.error('Error fetching notifications:', error)
    res.status(500).json({ error: error.message })
  }
})


// --- PHASE 5 ADMIN ENDPOINTS MOVED TO MODULAR ROUTER ---

// Safe 404 fallback route
app.use((req, res, next) => {
  next(new NotFoundError('Route not found'));
});

// Centralized error handling middleware
app.use(errorHandler);


let server;
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  server = app.listen(PORT, () => {
    console.log(`🚗 CarUp OS API Gateway listening on port ${PORT}`);
    console.log(`📡 Database: Supabase PostgreSQL`);
  });
}

export { app, server };
export default app;
