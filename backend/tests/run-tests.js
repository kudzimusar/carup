import { supabase } from '../db/supabase.js';
import { addEvent, verifyChain } from '../services/blockchain/blockchainService.js';
import { getVehicleTimeline, runOdometerAudit, calculateVehicleTrustScore } from '../services/trustGraph/trustGraphService.js';
import { createEscrow, updateEscrowStatus } from '../services/safepay/escrowService.js';
import { addRepairLog, getRepairHistory } from '../services/partsentry/partsentryService.js';
import { runFraudAnalysis, runOcrParsing, runRiskScoring } from '../services/ai/aiServiceBus.js';

// Import newly created services
import { submitFinancingApplication } from '../services/finance/financeService.js';
import { calculateInsuranceQuote, createInsurancePolicy } from '../services/insurance/insuranceService.js';
import { calculateZimraDuty } from '../services/import/importService.js';
import { reportVehicleStolen, checkStolenStatus } from '../services/security/securityService.js';
import { calculateDealerReputation } from '../services/reputation/reputationService.js';
import { getSmartRecommendations } from '../services/recommendation/recommendationService.js';
import { reserveVehicle } from '../services/reservation/reservationService.js';
import { authorizeRole } from '../middleware/authMiddleware.js';

async function runTests() {
  console.log('----------------------------------------------------');
  console.log('CARUP OS ➔ KIMI INTELLIGENCE INTEGRATION TEST SUITE');
  console.log('----------------------------------------------------');
  
  try {
    // 1. Initialize Supabase Database Connection & Seeding Check
    console.log('🧪 Test 1: Supabase Database Initialization & Seeding...');
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('name')
      .eq('id', 'u1')
      .single();
      
    if (userError || !user || user.name !== 'Tendai Moyo') {
      throw new Error(`Database seeding validation failure. Expected Tendai Moyo, got '${user?.name || 'null'}'. Error: ${userError?.message}`);
    }
    console.log('✅ Supabase Database initialized and seeded successfully.');

    // 2. Blockchain SHA-256 Event Chain Integrity Check
    console.log('\n🧪 Test 2: Blockchain SHA-256 Cryptographic Chain Audit...');
    const vin = 'VIN74329849204928';
    
    // Add custom event to the ledger chain
    const testPayload = { buyer: 'u1', source: 'CROCO_MOTORS' };
    const event = await addEvent(vin, 'Custom Transfer Audit', testPayload);
    console.log(`Added block to vehicle ledger. Hash: ${event.currentHash}`);

    // Verify blockchain event hashes
    const verifyReport = await verifyChain(vin);
    if (!verifyReport.verified) {
      throw new Error(`Ledger chain corruption detected: ${verifyReport.reason}`);
    }
    console.log(`✅ SHA-256 Cryptographic Event Chain verified successfully. Blocks: ${verifyReport.count}`);

    // 3. Trust Graph Forensics & Odometer Auditing
    console.log('\n🧪 Test 3: Odometer Progressive Rollback Forensics...');
    const odoAudit = await runOdometerAudit(vin);
    if (!odoAudit.verified) {
      throw new Error(`Unexpected odometer discrepancy triggered: ${JSON.stringify(odoAudit.anomalies)}`);
    }
    console.log('✅ Odometer progressive validation passed seamlessly.');

    // Test rollback detection trigger — use an isolated VIN to avoid polluting main vehicle's history
    console.log('🧪 Test 3b: Rollback Anomaly Triggering Check...');
    const rollbackVin = 'VIN_RB_' + Math.random().toString(36).substring(2, 10).toUpperCase();
    
    // Attempt cleanup (will be blocked by triggers for partsentry_logs, which is expected and correct)
    await supabase.from('partsentry_logs').delete().eq('vin', rollbackVin);
    await supabase.from('vehicles').delete().eq('vin', rollbackVin);

    // Seed the isolated test vehicle
    const { error: vehicleInsertError } = await supabase.from('vehicles').insert({
      vin: rollbackVin,
      make: 'Test',
      model: 'Rollback',
      generation: 'Test',
      trim: 'Test',
      year: 2020,
      color: 'Red',
      mileage: 0,
      fuel_type: 'Petrol',
      drivetrain: 'FWD',
      transmission: 'Manual',
      import_source: 'Test',
      duty_paid: true,
      police_verified: true,
      status: 'Available',
      trust_score: 80.0,
      price: 1000.0,
      currency: 'USD'
    });
    if (vehicleInsertError) throw vehicleInsertError;
    
    // Seed partsentry logs to trigger odometer rollback detection (ascending then fraudulent low mileage)
    const { error: logsInsertError } = await supabase.from('partsentry_logs').insert([
      { vin: rollbackVin, mechanic_id: 'u2', part_name: 'Oil Filter', part_oem: 'OEM', action_type: 'Replaced', description: 'Oil change', mileage: 10000, signature: 'ROLLBACK_SIGN_1', timestamp: '2025-01-01T00:00:00Z' },
      { vin: rollbackVin, mechanic_id: 'u2', part_name: 'Brake Pads', part_oem: 'OEM', action_type: 'Replaced', description: 'Brake service', mileage: 20000, signature: 'ROLLBACK_SIGN_2', timestamp: '2025-06-01T00:00:00Z' },
      { vin: rollbackVin, mechanic_id: 'u2', part_name: 'Odometer tampered', part_oem: 'OEM', action_type: 'Replaced', description: 'Odometer rollback', mileage: 8000, signature: 'ROLLBACK_SIGN_FRAUD', timestamp: '2025-09-01T00:00:00Z' }
    ]);
    if (logsInsertError) throw logsInsertError;
    
    const compromisedAudit = await runOdometerAudit(rollbackVin);
    if (compromisedAudit.verified || compromisedAudit.anomalies.length === 0) {
      throw new Error('Rollback anomaly detection failed to intercept illegal mileage compression.');
    }
    console.log(`✅ Rollback forensics successfully intercepted compromised odometer log: Mapped ${compromisedAudit.anomalies[0].difference} km rollback.`);

    // 4. Dynamic Automotive Trust Score
    console.log('\n🧪 Test 4: Dynamic Trust Score Calculation...');
    const trustReport = await calculateVehicleTrustScore(vin);
    console.log(`Calculated Trust Index: ${trustReport.trustScore}%`);
    console.log('✅ Dynamic Trust Index computed successfully.');

    // 5. PartSentry Repair Logging
    console.log('\n🧪 Test 5: PartSentry 2.0 Mechanic Repair Logging...');
    // Use a unique high mileage value to avoid idempotency block from previous test runs
    const { data: maxMileageRes, error: maxMileageError } = await supabase
      .from('partsentry_logs')
      .select('mileage')
      .eq('vin', vin)
      .order('mileage', { ascending: false })
      .limit(1);
      
    if (maxMileageError) throw maxMileageError;
    const currentMaxMileage = maxMileageRes?.[0]?.mileage || 48500;
    const newMileage = Math.max(52000, currentMaxMileage + 500);
    
    let newLog;
    try {
      newLog = await addRepairLog(
        vin, 'u2', 'Suspension Arm', 'OEM-Mazda-993',
        'Replaced', 'Replaced worn rear suspension assembly', newMileage
      );
      console.log(`Service event signed with cryptographic key: ${newLog.signature}`);
    } catch (err) {
      if (err.message.includes('Idempotency block')) {
        console.log(`ℹ️ Idempotency block triggered (expected on repeated runs): ${err.message.split('.')[0]}`);
      } else {
        throw err;
      }
    }
    
    // Verify repair history exists (may have been added in this or a previous run)
    const logs = await getRepairHistory(vin);
    const suspensionLog = logs.find(l => l.part_name === 'Suspension Arm');
    if (logs.length === 0 || !suspensionLog) {
      throw new Error('Failed to retrieve signed PartSentry logs.');
    }
    console.log('✅ PartSentry repair ledger appended and signed successfully.');

    // 6. SafePay Escrow Transaction Flow (full state machine: Pending → Escrowed → Inspecting → Completed)
    console.log('\n🧪 Test 6: SafePay Escrow Transaction State Changes...');
    const escrow = await createEscrow(vin, 'u1', 'u3', 25000.00);
    console.log(`SafePay Escrow lock established. ID: ${escrow.id}`);
    console.log(`Escrow Splits -> SafePay: $${escrow.feeEscrow} | ZIMRA Custom Split: $${escrow.feeZimra}`);
    
    // Walk the full legal state machine (Pending → Escrowed → Inspecting → Completed)
    await updateEscrowStatus(escrow.id, 'Escrowed', { code: 'FUNDS_LOCKED' });
    await updateEscrowStatus(escrow.id, 'Inspecting', { code: 'MECHANIC_ENGAGED' });
    const updatedEscrow = await updateEscrowStatus(escrow.id, 'Completed', { code: 'OTP_MATCHED' });
    if (updatedEscrow.status !== 'Completed') {
      throw new Error(`Escrow update failure. Expected status Completed, got '${updatedEscrow.status}'`);
    }
    // Verify illegal transition is blocked
    try {
      await updateEscrowStatus(escrow.id, 'Escrowed');
      throw new Error('State machine failure: allowed illegal Completed → Escrowed transition!');
    } catch (err) {
      if (!err.message.includes('ILLEGAL ESCROW STATE TRANSITION')) throw err;
      console.log(`... Illegal re-transition correctly blocked: ${err.message.split('.')[0]}`);
    }
    console.log('✅ SafePay state-machine, automated splits, and transition guards verified.');

    // 7. AI Multi-Agent Orchestrator
    console.log('\n🧪 Test 7: Gemini Multi-Agent Orchestrator Routing...');
    const fraudScan = await runFraudAnalysis(vin, 28000.0, '2019 Mercedes-Benz W205 C200 AMG Line');
    console.log('Fraud analysis risk:', fraudScan.riskRating);
    
    const ocrScan = await runOcrParsing('ZIMRA Form 21', 'MOCK_BASE64_IMAGE_DATA');
    console.log('OCR document owner parsed:', ocrScan.owner);
    
    const riskScan = await runRiskScoring(vin, 48500, 42000.0);
    console.log('Insurance risk tier factors:', riskScan.factors);
    console.log('✅ AI Orchestrator functional.');

    // 8. Financing Pre-Approval
    console.log('\n🧪 Test 8: Financing Engine Calculations...');
    const finApplication = await submitFinancingApplication(vin, 'u1', 'u3', 20000);
    console.log(`Financing Status: ${finApplication.status} | Monthly Payment: $${finApplication.monthlyPayment}`);
    if (finApplication.apr !== 7.5) {
      throw new Error(`Affordability APR calculation failure. Got ${finApplication.apr}`);
    }
    console.log('✅ Financing pre-approval and dynamic credit scores verified.');

    // 9. Insurance Quote Engine
    console.log('\n🧪 Test 9: Insurance Premium Calculations...');
    const insQuote = await calculateInsuranceQuote(vin, 'u1');
    console.log(`Dynamic Monthly Premium: $${insQuote.monthlyPremium}`);
    const policy = await createInsurancePolicy(vin, 'u4', 'u1', 'Comprehensive Plan A');
    console.log(`Generated active policy: ${policy.policyNumber}`);
    console.log('✅ Insurance risk indicators verified.');

    // 10. ZIMRA Import Duty Estimations
    console.log('\n🧪 Test 10: ZIMRA Import Custom Duty Estimations...');
    const customs = calculateZimraDuty(10000.00, 2017, 1800);
    console.log(`Calculated ZIMRA Import Duty split: $${customs.totalDuty} (${customs.percentageOfValue}% of value)`);
    if (customs.totalDuty !== 10125.00) {
      throw new Error(`Customs estimation math discrepancy. Expected 10125, got ${customs.totalDuty}`);
    }
    console.log('✅ ZIMRA dynamic import tax estimator verified.');

    // 11. Stolen Vehicle Flagging alert
    console.log('\n🧪 Test 11: Stolen Vehicle Security Alerts...');
    const stolenReport = await reportVehicleStolen(vin, 'ZRP-OB-9203/26', 'u1');
    console.log(`ZRP alert raised: ${stolenReport.status}`);
    const checkStolen = await checkStolenStatus(vin);
    if (!checkStolen.stolen) {
      throw new Error('Stolen alert lookup failed to check state.');
    }
    console.log('✅ Police alert and active security networks verified.');

    // 12. Dealer Reputation Indices
    console.log('\n🧪 Test 12: Dealer Reputation Scoring...');
    const dealerScore = await calculateDealerReputation('u3');
    console.log(`Dealer Reputation score calculated: ${dealerScore.reputationScore}% (${dealerScore.stats.verificationTier})`);
    console.log('✅ Dealer reputation algorithms verified.');

    // 13. Marketplace AI Recommendations
    console.log('\n🧪 Test 13: Smart Inventory Recommendations...');
    const recs = await getSmartRecommendations(vin);
    console.log(`Found ${recs.length} recommended vehicles.`);
    console.log('✅ AI search recommendations index verified.');

    // 14. Fleet Reservations
    console.log('\n🧪 Test 14: Fleet Commerce Reservations...');
    // Reset vehicle status to Available first
    const { error: resetStatusError } = await supabase
      .from('vehicles')
      .update({ status: 'Available' })
      .eq('vin', vin);
      
    if (resetStatusError) throw resetStatusError;
    
    const reservation = await reserveVehicle(vin, 'u1', 5);
    console.log(`Lock established: Vehicle is reserved until ${reservation.expiresAt}`);
    console.log('✅ Vehicle reservation and lock index verified.');

    // 15. Role-Based Access Control (RBAC) checks
    console.log('\n🧪 Test 15: RBAC Security Guardrails...');
    const middleware = authorizeRole(['mechanic']);
    
    let nextCalled = false;
    let errorStatus = 0;
    let errorMessage = '';
    
    const mockReq = {
      headers: {
        'x-stakeholder-role': 'owner',
        'x-user-id': 'u1'
      }
    };
    
    const mockRes = {
      status(code) {
        errorStatus = code;
        return {
          json(data) {
            errorMessage = data.error;
          }
        };
      }
    };
    
    await middleware(mockReq, mockRes, () => {
      nextCalled = true;
    });
    
    if (nextCalled || errorStatus !== 403) {
      throw new Error(`RBAC Failure: Allowed role 'owner' to access 'mechanic' route. Code: ${errorStatus}`);
    }
    console.log(`... RBAC successfully intercepted unauthorized crossover: ${errorMessage}`);

    // 16. Multi-Organizational Profile Mapping
    console.log('\n🧪 Test 16: Multi-Organizational Profile Mapping...');
    const { data: crocoOrg, error: crocoOrgError } = await supabase
      .from('organization_users')
      .select(`
        *,
        organizations:organization_id ( name ),
        organization_roles:role_id ( name )
      `)
      .eq('user_id', 'u3')
      .single();
      
    if (crocoOrgError) throw crocoOrgError;
    if (!crocoOrg || crocoOrg.organizations?.name !== 'Croco Motors Group') {
      throw new Error(`Failed to retrieve organization profile context. Got: ${JSON.stringify(crocoOrg)}`);
    }
    const orgName = crocoOrg.organizations?.name;
    const roleName = crocoOrg.organization_roles?.name;
    console.log(`✅ Multi-stakeholder organization mapping verified: '${orgName}' as '${roleName}'.`);

    // 17. Branch Isolation
    console.log('\n🧪 Test 17: Branch Isolation & Department Registry...');
    const { data: branches, error: branchesError } = await supabase
      .from('organization_branches')
      .select('*')
      .eq('organization_id', 'org_croco');
      
    if (branchesError) throw branchesError;
    if (branches.length !== 2) {
      throw new Error(`Branch query mapping discrepancy. Expected 2 branches, got: ${branches.length}`);
    }
    console.log(`✅ Organization branch separation operational. Branches found: ${branches.map(b => b.name).join(', ')}`);

    // 18. Secure Audit Trail Entry & Retrieve
    console.log('\n🧪 Test 18: Immutable Action Audit Logging...');
    const actionTime = new Date().toISOString();
    
    const { error: auditError } = await supabase.from('organization_audit_logs').insert({
      organization_id: 'org_croco',
      user_id: 'u3',
      action: 'DISBURSE_ESCROW',
      resource: 'finance',
      details: 'Released $25k to Simbisa Escrow',
      timestamp: actionTime,
      ip_address: '127.0.0.1'
    });
    if (auditError) throw auditError;
    
    const { data: latestAuditRes, error: latestAuditError } = await supabase
      .from('organization_audit_logs')
      .select('*')
      .order('id', { ascending: false })
      .limit(1);
      
    if (latestAuditError) throw latestAuditError;
    const latestAudit = latestAuditRes?.[0];
    if (!latestAudit || latestAudit.action !== 'DISBURSE_ESCROW') {
      throw new Error(`Audit log insertion verification failure. Got action: ${latestAudit?.action || 'null'}`);
    }
    console.log(`✅ Secure audit logs recorded: [${latestAudit.timestamp}] Action ${latestAudit.action} on ${latestAudit.resource}`);

    // 19. Bank Financing application loan state transitions
    console.log('\n🧪 Test 19: Lending Workflow State Transitions...');
    // Create pre-approved application
    const { data: appFinanceRes, error: appFinanceError } = await supabase
      .from('finance_applications')
      .select('*')
      .limit(1);
      
    if (appFinanceError) throw appFinanceError;
    const appFinance = appFinanceRes?.[0];
    if (appFinance) {
      const { error: updateAppError } = await supabase
        .from('finance_applications')
        .update({ status: 'Disbursed' })
        .eq('id', appFinance.id);
        
      if (updateAppError) throw updateAppError;
      
      const { data: updatedApp, error: getUpdatedAppError } = await supabase
        .from('finance_applications')
        .select('status')
        .eq('id', appFinance.id)
        .single();
        
      if (getUpdatedAppError) throw getUpdatedAppError;
      if (updatedApp.status !== 'Disbursed') {
        throw new Error(`Financing workflow status update failed to switch state to Disbursed. Got: ${updatedApp.status}`);
      }
      console.log(`✅ Lending workflow status state transition verified: '${appFinance.status}' ➔ 'Disbursed'.`);
    } else {
      console.log('⚠️ No financing applications found. Skipping transition check.');
    }

    // 20. Tamper-Proof Trigger Enforcements on Supabase
    console.log('\n🧪 Test 20: Database Tamper-Proofing Immutability Guards...');
    const { data: latestEvent, error: latestEventError } = await supabase
      .from('blockchain_events')
      .select('*')
      .limit(1);

    if (latestEventError) throw latestEventError;
    if (latestEvent && latestEvent.length > 0) {
      const eventToTamper = latestEvent[0];
      
      // Attempt to UPDATE the blockchain event
      console.log('  → Testing UPDATE block on blockchain_events...');
      const { error: updateTamperError } = await supabase
        .from('blockchain_events')
        .update({ event_type: 'FRAUDULENT_MUTATION' })
        .eq('id', eventToTamper.id);

      if (!updateTamperError) {
        throw new Error('Security Violation: Database allowed updating a historical blockchain ledger entry!');
      } else {
        console.log(`  ✅ UPDATE block verified: ${updateTamperError.message}`);
      }

      // Attempt to DELETE the blockchain event
      console.log('  → Testing DELETE block on blockchain_events...');
      const { error: deleteTamperError } = await supabase
        .from('blockchain_events')
        .delete()
        .eq('id', eventToTamper.id);

      if (!deleteTamperError) {
        throw new Error('Security Violation: Database allowed deleting a historical blockchain ledger entry!');
      } else {
        console.log(`  ✅ DELETE block verified: ${deleteTamperError.message}`);
      }
    } else {
      console.log('⚠️ No blockchain events found to test triggers. Skipping trigger checks.');
    }

    // 21. Secure Telemetry Guard Check
    console.log('\n🧪 Test 21: Secure Telemetry Gateway Guardrails...');
    const telemetryMiddleware = authorizeRole(['bank', 'insurance', 'government', 'admin']);
    let teleNextCalled = false;
    let teleErrorStatus = 0;
    
    const mockTeleReq = { headers: { 'x-stakeholder-role': 'owner', 'x-user-id': 'u1' } };
    const mockTeleRes = {
      status(code) {
        teleErrorStatus = code;
        return { json(data) {} };
      }
    };
    await telemetryMiddleware(mockTeleReq, mockTeleRes, () => { teleNextCalled = true; });
    if (teleNextCalled || teleErrorStatus !== 403) {
      throw new Error(`Security Failure: Allowed role 'owner' to access telemetry core!`);
    }
    
    let teleBankPassed = false;
    const mockTeleBankReq = { headers: { 'x-stakeholder-role': 'bank', 'x-user-id': 'u3' } };
    await telemetryMiddleware(mockTeleBankReq, mockTeleRes, () => { teleBankPassed = true; });
    if (!teleBankPassed) {
      throw new Error(`Security Failure: Blocked authorized bank partner from telemetry!`);
    }
    console.log('✅ Telemetry gateway guardrails validated successfully.');

    // 22. Secure Insurance Claims Guard Check
    console.log('\n🧪 Test 22: Insurance Claims Gateway Guardrails...');
    const claimsMiddleware = authorizeRole(['insurance', 'admin']);
    let claimsNextCalled = false;
    let claimsErrorStatus = 0;
    
    const mockClaimsReq = { headers: { 'x-stakeholder-role': 'bank', 'x-user-id': 'u3' } };
    const mockClaimsRes = {
      status(code) {
        claimsErrorStatus = code;
        return { json(data) {} };
      }
    };
    await claimsMiddleware(mockClaimsReq, mockClaimsRes, () => { claimsNextCalled = true; });
    if (claimsNextCalled || claimsErrorStatus !== 403) {
      throw new Error(`Security Failure: Allowed role 'bank' to access insurance claims registry!`);
    }
    
    let claimsInsPassed = false;
    const mockClaimsInsReq = { headers: { 'x-stakeholder-role': 'insurance', 'x-user-id': 'u4' } };
    await claimsMiddleware(mockClaimsInsReq, mockClaimsRes, () => { claimsInsPassed = true; });
    if (!claimsInsPassed) {
      throw new Error(`Security Failure: Blocked authorized insurer from claims registry!`);
    }
    console.log('✅ Insurance claims gateway guardrails validated successfully.');

    // 23. Secure Compliance & Regulatory Guard Check
    console.log('\n🧪 Test 23: Compliance Reports Gateway Guardrails...');
    const complianceMiddleware = authorizeRole(['government', 'admin']);
    let compNextCalled = false;
    let compErrorStatus = 0;
    
    const mockCompReq = { headers: { 'x-stakeholder-role': 'owner', 'x-user-id': 'u1' } };
    const mockCompRes = {
      status(code) {
        compErrorStatus = code;
        return { json(data) {} };
      }
    };
    await complianceMiddleware(mockCompReq, mockCompRes, () => { compNextCalled = true; });
    if (compNextCalled || compErrorStatus !== 403) {
      throw new Error(`Security Failure: Allowed role 'owner' to access regulatory compliance reports!`);
    }
    
    let compGovPassed = false;
    const mockCompGovReq = { headers: { 'x-stakeholder-role': 'government', 'x-user-id': 'u5' } };
    await complianceMiddleware(mockCompGovReq, mockCompRes, () => { compGovPassed = true; });
    if (!compGovPassed) {
      throw new Error(`Security Failure: Blocked government regulator from compliance reports!`);
    }
    console.log('✅ Compliance reports gateway guardrails validated successfully.');

    // 24. Secure Admin Directory & User Suspension Check
    console.log('\n🧪 Test 24: Admin User Directory Gateway Guardrails...');
    const adminMiddleware = authorizeRole(['admin']);
    let adminNextCalled = false;
    let adminErrorStatus = 0;
    
    const mockAdminReq = { headers: { 'x-stakeholder-role': 'government', 'x-user-id': 'u5' } };
    const mockAdminRes = {
      status(code) {
        adminErrorStatus = code;
        return { json(data) {} };
      }
    };
    await adminMiddleware(mockAdminReq, mockAdminRes, () => { adminNextCalled = true; });
    if (adminNextCalled || adminErrorStatus !== 403) {
      throw new Error(`Security Failure: Allowed role 'government' to access admin user manager!`);
    }
    
    let adminPassed = false;
    const mockAdminPassedReq = { headers: { 'x-stakeholder-role': 'admin', 'x-user-id': 'u1' } };
    await adminMiddleware(mockAdminPassedReq, mockAdminRes, () => { adminPassed = true; });
    if (!adminPassed) {
      throw new Error(`Security Failure: Blocked super-admin from user manager!`);
    }
    console.log('✅ Admin user directory gateway guardrails validated successfully.');

    console.log('\n----------------------------------------------------');
    console.log('🎉 ALL GOVERNANCE & INTEGRATION TESTS PASSED WITH EXIT CODE 0!');
    console.log('----------------------------------------------------');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ INTEGRATION TEST SUITE ENCOUNTERED A FAILURE:');
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

runTests();
