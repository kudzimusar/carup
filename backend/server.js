import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';

// ✅ Supabase client (replaces SQLite database.js)
import { supabase } from './db/supabase.js';

// Import Middleware
import { authorizeRole } from './middleware/authMiddleware.js';

// Import Services
import { getVehicleTimeline, runOdometerAudit, calculateVehicleTrustScore } from './services/trustGraph/trustGraphService.js';
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

// Central Error Handling Imports
import errorHandler from './middleware/errorMiddleware.js';
import { NotFoundError } from './utils/errors.js';

// Centralized Routes Imports (Batch 1)
import leadsRouter from './routes/leadsRoutes.js';
import promotionsRouter from './routes/promotionsRoutes.js';
import workOrdersRouter from './routes/workOrdersRoutes.js';
import partsRouter from './routes/partsRoutes.js';
import claimsRouter from './routes/claimsRoutes.js';

// Centralized Routes Imports (Batch 2)
import adminRouter from './routes/adminRoutes.js';
import vehiclesRouter from './routes/vehiclesRoutes.js';
import complianceRouter from './routes/complianceRoutes.js';
import financeRouter from './routes/financeRoutes.js';

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

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

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
app.use(adminRouter);
app.use(vehiclesRouter);
app.use(complianceRouter);
app.use(financeRouter);

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
  eventWorker.start(1000); // Concurrency-safe interval poller (1s)
}

// --- PILLAR 20: AUTH & STAKEHOLDER PORTAL SWITCHING ---
app.post('/api/auth/switch-role', async (req, res) => {
  const { userId, role, tenantId } = req.body;
  
  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (userError || !user) return res.status(404).json({ error: 'User record not found' });
    
    // Fetch organization/tenant context if tenantId provided
    let verifiedTenantId = null;
    if (tenantId) {
      const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('tenant_id')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .single();
        
      if (tenantUser) {
        verifiedTenantId = tenantUser.tenant_id;
      }
    }
    
    // Generate secure session
    const token = 'sk_live_' + crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    
    await supabase.from('user_sessions').insert({
      user_id: userId,
      token,
      ip_address: req.ip || '127.0.0.1',
      user_agent: req.headers['user-agent'],
      expires_at: expiresAt.toISOString(),
      is_valid: true
    });
    
    res.json({
      success: true,
      message: `Role switched to ${role} successfully (session established).`,
      token,
      user: { ...user, role, active_tenant_id: verifiedTenantId }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// --- VEHICLE SINGLE FETCH ---
app.get('/api/vehicles/:vin/details', async (req, res) => {
  const { vin } = req.params;
  try {
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select('*, tenant:tenants(name, phone, logo_url)')
      .eq('vin', vin)
      .single();
    if (error) throw error;
    res.json(vehicle);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 8: ADVANCED TAXONOMY & SEARCH ---
app.get('/api/vehicles', async (req, res) => {
  const { make, model, minPrice, maxPrice, drivetrain, dutyPaid, policeVerified, trustRange } = req.query;
  
  try {
    let query = supabase.from('vehicles').select('*');
    
    // Explicitly enforce public visibility constraint unless specifically fetching for a tenant (handled below or in another endpoint)
    query = query.eq('status', 'Available');

    if (make) query = query.eq('make', make);
    if (model) query = query.eq('model', model);
    if (minPrice) query = query.gte('price', parseFloat(minPrice));
    if (maxPrice) query = query.lte('price', parseFloat(maxPrice));
    if (drivetrain) query = query.eq('drivetrain', drivetrain);
    if (dutyPaid !== undefined) query = query.eq('duty_paid', dutyPaid === 'true');
    if (policeVerified !== undefined) query = query.eq('police_verified', policeVerified === 'true');
    if (trustRange) query = query.gte('trust_score', parseFloat(trustRange));
    
    const { data: vehicles, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    
    res.json(vehicles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLARS 1, 6 & 7: TRUST GRAPH, SCORE & PASSPORT ---
app.get('/api/vehicles/:vin/passport', async (req, res) => {
  const { vin } = req.params;
  
  try {
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('vin', vin)
      .single();
      
    if (vehicleError || !vehicle) return res.status(404).json({ error: 'VIN not found' });
    
    const timeline = await getVehicleTimeline(vin);
    const trustReport = await calculateVehicleTrustScore(vin);
    const chainVerification = await verifyChain(vin);
    
    res.json({ vehicle, timeline, trustReport, chainVerification });
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
    let query = supabase
      .from('safepay_escrows')
      .select('*, vehicles(make, model, year, price, currency), buyer:users!safepay_escrows_buyer_id_fkey(name, email, phone), seller:users!safepay_escrows_seller_id_fkey(name, email, phone)')
      .order('created_at', { ascending: false });

    // Scope queries depending on who is asking
    if (role === 'dealer' || role === 'owner') {
      query = query.or(`seller_id.eq.${userId},buyer_id.eq.${userId}`);
    } else if (role === 'bank') {
      // For banks we just let them see all, or we could filter based on finance apps (simplified)
    } else {
      query = query.eq('buyer_id', userId);
    }
    
    const { data: escrows, error } = await query;
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
app.post('/api/partsentry/add', authorizeRole(['mechanic']), async (req, res) => {
  const { vin, mechanicId, partName, partOem, actionType, description, mileage } = req.body;
  try {
    const log = await addRepairLog(vin, mechanicId, partName, partOem, actionType, description, mileage);
    res.json(log);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/partsentry/:vin', async (req, res) => {
  const { vin } = req.params;
  try {
    const history = await getRepairHistory(vin);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 5: OCR DOCUMENT EXTRACTION ---
app.post('/api/ai/ocr', async (req, res) => {
  const { docType, base64Data } = req.body;
  try {
    const parsedData = await runOcrParsing(docType, base64Data);
    res.json({ success: true, extractedData: parsedData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 4: AI FRAUD & RISK SCANNERS ---
app.post('/api/ai/fraud-scan', async (req, res) => {
  const { vin, price, listingTitle } = req.body;
  try {
    const fraudScore = await runFraudAnalysis(vin, price, listingTitle);
    res.json(fraudScore);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/risk-assessment', async (req, res) => {
  const { vin, mileage, basePrice } = req.body;
  try {
    const riskReport = await runRiskScoring(vin, mileage, basePrice);
    res.json(riskReport);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 10: FINANCING pre-approval & affordability ---
app.post('/api/finance/pre-approve', authorizeRole(), async (req, res) => {
  const { vin, bankId, requestedAmount } = req.body;
  const userId = req.userContext.userId;
  try {
    const result = await submitFinancingApplication(vin, userId, bankId, requestedAmount);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- PILLAR 9: FLEET VEHICLE RESERVATIONS ---
app.post('/api/vehicles/:vin/reserve', async (req, res) => {
  const { vin } = req.params;
  const { buyerId, duration } = req.body;
  try {
    const result = await reserveVehicle(vin, buyerId, duration);
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
app.get('/api/organizations/:id/audit-logs', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: logs, error } = await supabase
      .from('organization_audit_logs')
      .select('*')
      .eq('organization_id', id)
      .order('id', { ascending: false });
    if (error) throw error;
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Post audit log
app.post('/api/organizations/:id/audit-logs', async (req, res) => {
  const { id } = req.params;
  const { userId, action, resource, details } = req.body;
  try {
    const timestamp = new Date().toISOString();
    const { error } = await supabase.from('organization_audit_logs').insert({
      organization_id: id,
      user_id: userId || 'u3',
      action,
      resource,
      details,
      timestamp,
      ip_address: '192.168.1.100'
    });
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      .select('id, name, email, phone, role')
      .eq('email', email)
      .single();
      
    if (error || !user) {
      await supabase.from('login_attempts').insert({ success: false, method: 'password', ip_address: req.ip || '127.0.0.1' });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    
    // Generate actual session token in the database (No more mocks)
    const token = 'sk_live_' + crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    
    await supabase.from('user_sessions').insert({
      user_id: user.id,
      token,
      ip_address: req.ip || '127.0.0.1',
      user_agent: req.headers['user-agent'],
      expires_at: expiresAt.toISOString(),
      is_valid: true
    });
    
    await supabase.from('login_attempts').insert({ user_id: user.id, success: true, method: 'password', ip_address: req.ip || '127.0.0.1' });
    
    res.json({ user, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- AUTH: Register ---
app.post('/api/auth/register', async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
      
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
    
    const id = 'u_' + crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    const { error } = await supabase.from('users').insert({
      id, name, email, phone: phone || '', role: role || 'owner', join_date: new Date().toISOString()
    });
    
    if (error) throw error;
    
    // Automatically issue a session
    const token = 'sk_live_' + crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    
    await supabase.from('user_sessions').insert({
      user_id: id,
      token,
      ip_address: req.ip || '127.0.0.1',
      user_agent: req.headers['user-agent'],
      expires_at: expiresAt.toISOString(),
      is_valid: true
    });
    
    const newUser = { id, name, email, phone: phone || '', role: role || 'owner' };
    res.json({ user: newUser, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- VEHICLE LISTING: Create new listing ---
app.post('/api/vehicles/add', authorizeRole(['dealer', 'owner', 'admin']), async (req, res) => {
  const { vin, make, model, year, color, mileage, fuel_type, transmission, condition, category, price, currency, description, location, province, images } = req.body;
  if (!vin || !make || !model || !price) return res.status(400).json({ error: 'VIN, make, model, and price are required' });
  try {
    const { data: existing } = await supabase.from('vehicles').select('vin').eq('vin', vin).single();
    if (existing) return res.status(409).json({ error: 'A vehicle with this VIN is already listed' });
    
    const tenantId = req.userContext.tenantId;

    const { error: insertError } = await supabase.from('vehicles').insert({
      vin, make, model, generation: '', trim: '', year: year || 2020, color: color || 'White', 
      mileage: mileage || 0, fuel_type: fuel_type || 'Petrol', drivetrain: 'RWD', 
      transmission: transmission || 'Automatic', import_source: 'Local', duty_paid: false, 
      police_verified: false, status: 'Available', trust_score: 50, price, currency: currency || 'USD',
      tenant_id: tenantId // Force assignment to the current tenant
    });
    if (insertError) throw insertError;
    
    if (req.userContext.id) {
      await supabase.from('vehicle_ownership_history').insert({
        vin, new_owner_id: req.userContext.id, transfer_date: new Date().toISOString(), transfer_hash: 'INITIAL'
      });
    }

    // Persist listing images directly in the listing_images table
    if (Array.isArray(images) && images.length > 0) {
      const imageRecords = images.map((url, idx) => ({
        vin,
        image_url: url,
        is_primary: idx === 0,
        display_order: idx
      }));
      const { error: imageError } = await supabase.from('listing_images').insert(imageRecords);
      if (imageError) {
        console.error('⚠️ Failed to save listing images:', imageError.message);
      }
    }

    res.json({ success: true, vin, message: 'Vehicle listed successfully on CarUp Marketplace' });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

// ✅ Health check endpoint
app.get('/api/health', async (req, res) => {
  const { data, error } = await supabase.from('vehicles').select('count').limit(1);
  res.json({
    status: error ? 'degraded' : 'healthy',
    database: error ? 'Supabase error: ' + error.message : 'Supabase connected',
    timestamp: new Date().toISOString()
  });
});

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
    res.json(data || [])
  } catch (error) {
    console.error('Error fetching owned vehicles:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /api/vehicles/saved - Get vehicles saved by the current user
app.get('/api/vehicles/saved', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('saved_vehicles')
      .select('*, vehicles(*)')
      .eq('user_id', req.userContext.id)

    if (error) throw error
    res.json(data.map(sv => sv.vehicles))
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
app.get('/api/service-history/me', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  try {
    // 1. Get user's vehicles
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('vin')
      .eq('owner_id', req.userContext.id)
    
    if (!vehicles || vehicles.length === 0) return res.json([])
    
    const vins = vehicles.map(v => v.vin)

    // 2. Get work orders for these vehicles
    const { data, error } = await supabase
      .from('mechanic_work_orders')
      .select('*')
      .in('vin', vins)

    if (error) throw error
    res.json(data || [])
  } catch (error) {
    console.error('Error fetching service history:', error)
    res.status(500).json({ error: error.message })
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


app.listen(PORT, () => {
  console.log(`🚗 CarUp OS API Gateway listening on port ${PORT}`);
  console.log(`📡 Database: Supabase PostgreSQL (vhmnajoeicasaigiophh)`);
});
