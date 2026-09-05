import { supabase } from '../../db/supabase.js';
import { addEvent } from '../blockchain/blockchainService.js';

export async function calculateInsuranceQuote(vin, userId) {
  const { data: vehicle } = await supabase.from('vehicles').select('*').eq('vin', vin).single();
  if (!vehicle) throw new Error('Vehicle record not found');
  
  const { data: profile } = await supabase.from('stakeholder_profiles').select('trust_score').eq('user_id', userId).single();
  const trustScore = profile ? profile.trust_score : 50.0;
  
  const baseYearly = vehicle.price * 0.035;
  let agePenalty = (new Date().getFullYear() - vehicle.year) * 0.02;
  let mileagePenalty = (vehicle.mileage / 100000) * 0.05;
  let trustBonus = (trustScore - 70.0) * -0.005;
  
  const riskMultiplier = 1.0 + agePenalty + mileagePenalty + trustBonus;
  const finalYearly = parseFloat((baseYearly * riskMultiplier).toFixed(2));
  const finalMonthly = parseFloat((finalYearly / 12).toFixed(2));
  
  const riskScore = parseFloat(Math.min(100.0, Math.max(10.0, 50.0 + (agePenalty * 100) - (trustScore - 70.0))).toFixed(1));

  return { vin, userId, yearlyPremium: finalYearly, monthlyPremium: finalMonthly, riskScore, currency: vehicle.currency, appliedDiscounts: trustScore >= 80.0 ? ['High Stakeholder Trust Discount'] : [] };
}

export async function createInsurancePolicy(vin, insurerId, userId, coverageDetails) {
  const quote = await calculateInsuranceQuote(vin, userId);
  
  const id = 'ins_' + Math.random().toString(36).substring(2, 11);
  const policyNumber = 'POL-' + Math.random().toString().substring(2, 10);
  const startDate = new Date().toISOString().split('T')[0];
  
  const endYear = new Date().getFullYear() + 1;
  const endDate = `${endYear}-${new Date().toISOString().split('T')[0].substring(5)}`;
  
  await supabase.from('insurance_records').insert({ id, vin, insurer_id: insurerId, policy_number: policyNumber, coverage_details: coverageDetails, premium_amount: quote.yearlyPremium, start_date: startDate, end_date: endDate, active: true, risk_score: quote.riskScore });
  
  // The insurance_records id is allocated before the row is written and is therefore the
  // durable operation identity for this policy's ledger event.
  await addEvent(
    vin,
    'Insurance Insured',
    { policyId: id, policyNumber, premiumAmount: quote.yearlyPremium, insurerId, riskScore: quote.riskScore },
    'SYSTEM_SIGNATURE',
    { operationId: `insurance_policy:${encodeURIComponent(id)}` },
  );

  return { id, vin, policyNumber, insurerId, premiumAmount: quote.yearlyPremium, startDate, endDate, riskScore: quote.riskScore, active: true };
}
