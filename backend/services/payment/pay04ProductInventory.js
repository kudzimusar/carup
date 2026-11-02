/**
 * CARUP-PAY-04-LR01 — the PAY-04 product inventory (directive §4), DERIVED from the accepted PAY-02 catalogue.
 *
 * Every commercial fact (seller, beneficiary, payer, currencies, price authority, providers, refund policy, fulfilment)
 * is read from PAY02_CATALOGUE — never restated or invented here. PAY-04 adds only what it changed or found: the
 * implementation status after PAY-04, the commercial-activation blocker and its accountable resolver. No price is
 * stated: where PAY-02 has no approved tariff, the inventory says so.
 */
import { PAY02_CATALOGUE_BY_CODE } from './pay02CatalogueDefinitions.js';

const PAY04_FINDINGS = Object.freeze({
  'gar.invoice.customer_payment': {
    status: 'IMPLEMENTED_LEVEL1',
    implemented: [
      'Mode 1 garage-recorded external payments (cash, bank transfer, mobile money, external card, other): OPS07, preserved',
      'invoice-line provenance (parts from recorded consumption on the job; labour/fees from the job\'s service records)',
      'Mode 2 provider-confirmed payments on the canonical ledger as third-party garage money (local simulator only)',
      'allocation ledger, reservation of in-flight money, provider receipts on the shared RCT counter, discrepancies, F5 holds',
    ],
    blocker: 'PROVIDER: no authorized Zimbabwe collection provider, no garage merchant contract, no provider credentials (Level 2); '
      + 'production activation forbidden (Level 3: merchant agreements, tariffs, tax, legal terms, settlement authority).',
    resolver: 'Owner + garage (merchant contract) + provider (credentials) — PAY-05 provider certification',
  },
  'gar.appointment.booking_deposit': {
    status: 'BLOCKED_NO_APPROVED_BOOKING_POLICY',
    implemented: ['OPS03 scheduling and capacity preserved; no appointment is ever marked financially settled by a booking'],
    blocker: 'COMMERCIAL: no approved deposit or cancellation policy and no tariff; a deposit contract may be built only where an approved booking policy exists.',
    resolver: 'Owner (deposit policy, tariff, cancellation/refund terms)',
  },
  'gar.work_order.diagnostic_fee': {
    status: 'IMPLEMENTED_AS_INVOICE_LINE',
    implemented: ['billed only as a fee/labour line on the OPS07 invoice of an authorized, completed job; a line naming a service record must name one of that job\'s records'],
    blocker: 'PROVIDER (same as gar.invoice.customer_payment) for provider-confirmed collection; no standalone diagnostic charge exists.',
    resolver: 'Owner + provider (as above)',
  },
  'gar.parts.retail_sale': {
    status: 'WORKSHOP_CONSUMPTION_IMPLEMENTED_RETAIL_SALE_DEPENDENCY',
    implemented: [
      'a part line is billed only from recorded, un-reversed OPS06 consumption on the same job, never for more than was used',
      'invoicing, payments and provider webhooks never move stock (one deduction: the recorded consumption)',
    ],
    blocker: 'PRODUCT: no governed counter/retail sale authority (no sale record, no stock-out without a job, no supplier settlement).',
    resolver: 'Product owner (retail sale authority) — a future Garage work package',
  },
  'gar.fleet.scheduled_maintenance': {
    status: 'DEPENDENCY_NO_FLEET_SOURCE',
    implemented: [],
    blocker: 'PRODUCT: no fleet account, fleet contract or consolidated statement authority exists; none is invented.',
    resolver: 'Product owner (fleet accounts) + Owner (B2B terms)',
  },
  'gar.towing.breakdown_dispatch': {
    status: 'DEPENDENCY_NO_DISPATCH_SOURCE',
    implemented: [],
    blocker: 'PRODUCT: no roadside dispatch record, distance tariff or towing-operator settlement authority exists; none is invented.',
    resolver: 'Product owner (dispatch workflow) + Owner (tariff, operator agreements)',
  },
});

export const PAY04_PRODUCT_CODES = Object.freeze(Object.keys(PAY04_FINDINGS));

export function pay04ProductInventory() {
  return PAY04_PRODUCT_CODES.map((code) => {
    const p = PAY02_CATALOGUE_BY_CODE[code];
    if (!p) throw new Error(`PAY-02 catalogue has no ${code}`);
    const f = PAY04_FINDINGS[code];
    return {
      productCode: code,
      title: p.title,
      owningSubsystem: p.owningSubsystem,
      sourceAuthority: `${p.sourceObjectType} (${p.databaseAuthority || p.owningSubsystem})`,
      legalSeller: p.contractualSeller,
      legalBeneficiary: p.legalBeneficiary,
      fundsOwner: p.fundsOwner,
      payer: p.payerRole,
      currencies: p.permittedCurrencies,
      tariff: p.approvedAmountMinor === null || p.approvedAmountMinor === undefined
        ? `none approved (${p.priceAuthorityType})` : 'approved in PAY-02',
      providerAuthority: { eligible: p.eligibleProviders, prohibited: p.prohibitedProviders },
      refundRules: p.refundPolicy,
      fulfillment: p.fulfillmentContract,
      pay02: { activationState: p.activationState, certificationState: p.certificationState, blockerClass: p.blockerClass },
      pay04Status: f.status,
      implemented: f.implemented,
      blocker: f.blocker,
      resolver: f.resolver,
    };
  });
}

export default { pay04ProductInventory, PAY04_PRODUCT_CODES };
