import { supabase } from '../../db/supabase.js';
import { addEvent } from '../blockchain/blockchainService.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';

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

export async function submitFinancingApplication(vin, userId, bankId, requestedAmount) {
  const { data: vehicle } = await supabase.from('vehicles').select('price').eq('vin', vin).single();
  if (!vehicle) throw new Error('Vehicle record not found');
  
  const affordability = await checkAffordability(userId, 5000, 1000, requestedAmount);
  const id = 'fin_' + Math.random().toString(36).substring(2, 11);
  const status = affordability.approved ? 'Approved' : 'Rejected';
  const timestamp = new Date().toISOString();
  
  await supabase.from('finance_applications').insert({ id, vin, user_id: userId, bank_id: bankId, requested_amount: requestedAmount, status, monthly_payment: affordability.estimatedMonthlyPayment, apr: affordability.estimatedApr, created_at: timestamp });
  
  await addEvent(vin, 'Financing Application', { applicationId: id, bankId, requestedAmount, status, apr: affordability.estimatedApr, monthlyPayment: affordability.estimatedMonthlyPayment });

  emitDomainEvent(null, 'finance.application.status_changed', {
    applicationId: id,
    userId,
    recipientUserId: userId,
    bankId,
    vin,
    requestedAmount,
    status,
  }, bankId).catch(() => {});

  return { id, vin, userId, bankId, requestedAmount, status, monthlyPayment: affordability.estimatedMonthlyPayment, apr: affordability.estimatedApr, rejectionReason: affordability.rejectionReason };
}
