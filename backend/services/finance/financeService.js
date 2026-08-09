import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { addEvent } from '../blockchain/blockchainService.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { ValidationError } from '../../utils/errors.js';

export function calculateMonthlyPayment(amount, apr, termMonths, downPayment = 0) {
  const principal = amount - downPayment;
  if (principal <= 0) return 0;
  const monthlyRate = (apr / 100) / 12;
  if (monthlyRate === 0) return parseFloat((principal / termMonths).toFixed(2));
  const payment = (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / (Math.pow(1 + monthlyRate, termMonths) - 1);
  return parseFloat(payment.toFixed(2));
}

export async function checkAffordability(userId, monthlyIncome, monthlyDebts, vehiclePrice) {
  const { data: profile } = await supabase.from('stakeholder_profiles').select('trust_score').eq('user_id', userId).single();
  const trustScore = profile ? profile.trust_score : 50.0;
  
  let baseApr = 15.0;
  if (trustScore >= 90.0) baseApr = 7.5;
  else if (trustScore >= 80.0) baseApr = 10.0;
  else if (trustScore >= 70.0) baseApr = 12.0;
  
  const monthlyPayment = calculateMonthlyPayment(vehiclePrice, baseApr, 60, vehiclePrice * 0.1);
  const debtToIncomeRatio = ((monthlyDebts + monthlyPayment) / monthlyIncome) * 100;
  
  let approved = true;
  let rejectionReason = null;
  if (debtToIncomeRatio > 45) { approved = false; rejectionReason = 'Debt-to-Income (DTI) ratio exceeds 45% standard lending limit.'; }
  else if (trustScore < 60.0) { approved = false; rejectionReason = 'Stakeholder Trust Index is below required standard threshold.'; }
  
  return { userId, vehiclePrice, estimatedApr: baseApr, estimatedMonthlyPayment: monthlyPayment, debtToIncomeRatio: parseFloat(debtToIncomeRatio.toFixed(2)), approved, rejectionReason };
}

// tenantId MUST be the caller-verified tenant scope (req.userContext.tenantId), never a
// client-supplied value: null means platform scope. It is stamped on the application row
// and on the emitted domain event.
export async function submitFinancingApplication(vin, userId, bankId, requestedAmount, tenantId = null) {
  const { data: vehicle } = await supabase.from('vehicles').select('price').eq('vin', vin).single();
  if (!vehicle) throw new Error('Vehicle record not found');

  // bankId arrives from req.body (client-supplied users.id): verify it references a real
  // lender before it is persisted or emitted anywhere.
  const { data: bank } = await supabase.from('users').select('role').eq('id', bankId).single();
  if (!bank || String(bank.role).toLowerCase() !== 'bank') {
    throw new ValidationError('bankId must reference a user with the bank role.');
  }

  const affordability = await checkAffordability(userId, 5000, 1000, requestedAmount);
  const id = 'fin_' + crypto.randomUUID();
  const status = affordability.approved ? 'Approved' : 'Rejected';
  const timestamp = new Date().toISOString();

  const applicationRow = { id, vin, user_id: userId, bank_id: bankId, requested_amount: requestedAmount, status, monthly_payment: affordability.estimatedMonthlyPayment, apr: affordability.estimatedApr, created_at: timestamp };
  if (tenantId) applicationRow.tenant_id = tenantId;
  await supabase.from('finance_applications').insert(applicationRow);
  
  await addEvent(vin, 'Financing Application', { applicationId: id, bankId, requestedAmount, status, apr: affordability.estimatedApr, monthlyPayment: affordability.estimatedMonthlyPayment });

  const decisionPayload = {
    applicationId: id,
    userId,
    recipientUserId: userId,
    bankId,
    vin,
    requestedAmount,
    status,
  };
  // Exactly ONE event per transition: terminal decisions emit their specific
  // event, everything else the coarse status_changed — emitting both queued a
  // duplicate notification for the same decision.
  //
  // Tenant scope is the VERIFIED tenantId (null = platform), NEVER bankId: bank_id
  // is a users.id, and stamping it into domain_events.tenant_id (and from there into
  // message_threads / notification_queue) split-brains tenant scoping.
  if (status === 'Approved') {
    emitDomainEvent(null, 'finance.application.approved', decisionPayload, tenantId).catch(() => {});
  } else if (status === 'Rejected') {
    emitDomainEvent(null, 'finance.application.declined', decisionPayload, tenantId).catch(() => {});
  } else {
    emitDomainEvent(null, 'finance.application.status_changed', decisionPayload, tenantId).catch(() => {});
  }

  return { id, vin, userId, bankId, requestedAmount, status, monthlyPayment: affordability.estimatedMonthlyPayment, apr: affordability.estimatedApr, rejectionReason: affordability.rejectionReason };
}
