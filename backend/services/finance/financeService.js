import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { addEvent } from '../blockchain/blockchainService.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { isClaimSource } from '../../utils/publicVehicleProjection.js';
import { ConflictError, ValidationError } from '../../utils/errors.js';
import { toFiniteFinanceNumber } from '../../utils/financeScalar.js';

export function calculateMonthlyPayment(amount, apr, termMonths, downPayment = 0) {
  const principal = Number(amount) - Number(downPayment);
  const rate = Number(apr);
  const term = Number(termMonths);
  if (!Number.isFinite(principal) || !Number.isFinite(rate) || !Number.isFinite(term) || term <= 0) {
    throw new ValidationError('Explicit amount, APR and positive term are required to calculate a payment.');
  }
  if (principal <= 0) return 0;
  const monthlyRate = (rate / 100) / 12;
  if (monthlyRate === 0) return parseFloat((principal / term).toFixed(2));
  const payment = (principal * monthlyRate * Math.pow(1 + monthlyRate, term))
    / (Math.pow(1 + monthlyRate, term) - 1);
  return parseFloat(payment.toFixed(2));
}

/**
 * Pure affordability arithmetic for a caller that ALREADY holds real financial inputs and quoted
 * loan terms. It does not fetch a fallback Trust score, invent income/debt, choose an APR or decide
 * approval. A lender/provider decision is a different governed action.
 */
export function checkAffordability(monthlyIncome, monthlyDebts, monthlyPayment) {
  const income = Number(monthlyIncome);
  const debts = Number(monthlyDebts);
  const payment = Number(monthlyPayment);
  if (!Number.isFinite(income) || income <= 0 || !Number.isFinite(debts) || debts < 0
      || !Number.isFinite(payment) || payment < 0) {
    throw new ValidationError('Affordability requires explicit positive income and non-negative debt/payment inputs.');
  }
  return {
    debtToIncomeRatio: parseFloat((((debts + payment) / income) * 100).toFixed(2)),
  };
}

/**
 * Record an applicant request. Applicant identity is server-derived by the route; amount is the
 * applicant's requested amount but is bounded by the current listing. Currency/provenance comes
 * from the listing. No income, debt, APR, monthly payment or approval is fabricated by CarUp.
 */
export async function submitFinancingApplication(vin, userId, bankId, requestedAmount, tenantId = null) {
  const applicant = String(userId || '').trim();
  const lender = String(bankId || '').trim();
  // Scalar guard: accept only a primitive number or a nonblank numeric string. A bare `Number()`
  // would coerce `true`→1 and `[500]`→500, letting a non-scalar JSON value be persisted as a genuine
  // financing request; reject by type before conversion, exactly as the approval-term validators do.
  const amount = toFiniteFinanceNumber(requestedAmount);
  if (!applicant) throw new ValidationError('Authenticated applicant identity is required.');
  if (!lender) throw new ValidationError('A lender selection is required.');
  if (amount === null || amount <= 0) throw new ValidationError('Requested amount must be positive.');

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('vin, price, currency, currency_source, publication_status')
    .eq('vin', vin)
    .maybeSingle();
  if (vehicleError) throw new Error(vehicleError.message);
  if (!vehicle) throw new ValidationError('Vehicle record not found.');
  if (String(vehicle.publication_status || '').toLowerCase() !== 'published') {
    throw new ConflictError('Financing requests require a currently published listing.');
  }

  const listingPrice = Number(vehicle.price);
  if (!Number.isFinite(listingPrice) || listingPrice <= 0) {
    throw new ValidationError('Listing has no server-authoritative price.');
  }
  if (amount > listingPrice) {
    throw new ValidationError('Requested amount cannot exceed the current listing price.');
  }
  const currency = String(vehicle.currency || '').trim().toUpperCase();
  const currencySource = String(vehicle.currency_source || '').trim();
  if (!currency || !currencySource || !isClaimSource(currencySource)) {
    throw new ValidationError('Listing has no provenance-backed financing currency.');
  }

  const { data: bank, error: bankError } = await supabase
    .from('users')
    .select('role')
    .eq('id', lender)
    .maybeSingle();
  if (bankError) throw new Error(bankError.message);
  if (!bank || String(bank.role).toLowerCase() !== 'bank') {
    throw new ValidationError('bankId must reference a user with the bank role.');
  }

  const id = `fin_${crypto.randomUUID()}`;
  const status = 'Pending';
  const timestamp = new Date().toISOString();
  const applicationRow = {
    id,
    vin,
    user_id: applicant,
    bank_id: lender,
    requested_amount: amount,
    requested_currency: currency,
    requested_currency_source: currencySource,
    status,
    monthly_payment: null,
    apr: null,
    decision_source: null,
    decision_recorded_at: null,
    decision_reason: null,
    created_at: timestamp,
  };
  if (tenantId) applicationRow.tenant_id = tenantId;

  const { error: insertError } = await supabase.from('finance_applications').insert(applicationRow);
  if (insertError) throw new Error(`Failed to record finance request: ${insertError.message}`);

  // The finance_applications id is allocated and committed before this ledger write, so a
  // retry of this same application recomputes the same operation identity.
  await addEvent(
    vin,
    'Financing Application',
    {
      applicationId: id,
      bankId: lender,
      requestedAmount: amount,
      requestedCurrency: currency,
      status,
    },
    'SYSTEM_SIGNATURE',
    { operationId: `finance_application:${encodeURIComponent(id)}` },
  );

  emitDomainEvent(null, 'finance.application.status_changed', {
    applicationId: id,
    userId: applicant,
    recipientUserId: applicant,
    bankId: lender,
    vin,
    requestedAmount: amount,
    requestedCurrency: currency,
    status,
  }, tenantId).catch(() => {});

  return {
    id,
    vin,
    userId: applicant,
    bankId: lender,
    requestedAmount: amount,
    requestedCurrency: currency,
    status,
    monthlyPayment: null,
    apr: null,
    decisionState: 'not_decided',
  };
}
