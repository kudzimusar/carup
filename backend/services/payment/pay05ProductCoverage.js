/**
 * CARUP-PAY-05-LR01 — Zimbabwe-collection coverage of EVERY PAY-02 product (issue #252 §I: "master gap coverage of all
 * applicable PAY-02 products"), DERIVED from the accepted PAY-02 catalogue. Nothing commercial is restated here: who sells,
 * who owns the funds, the currencies and the price authority come from PAY02_CATALOGUE.
 *
 * The disposition follows the legal ownership of the money (directive, Checkpoint C):
 *  - a garage's customer money -> the garage's OWN verified Paynow merchant (implemented, Level 1 simulator only);
 *  - CarUp first-party Zimbabwe products -> only with an approved CarUp ZW merchant AND an approved tariff: neither exists,
 *    so blocked (the collection tables bind to garage invoices; no first-party Paynow path exists to misuse);
 *  - money CarUp would hold for someone else (buyer deposits) -> blocked: custody needs a licensed arrangement, and Paynow's
 *    terms forbid collecting on behalf of others;
 *  - other third parties (sellers, insurers, lenders, government, freight, carriers) -> their own funds; later packages;
 *  - corporate treasury flows -> never a customer checkout (PAY-09);
 *  - products outside Zimbabwe -> not a Zimbabwe collection.
 */
import { PAY02_CATALOGUE } from './pay02CatalogueDefinitions.js';

export const PAY05_DISPOSITIONS = Object.freeze({
  IMPLEMENTED_LEVEL1: 'Implemented at Level 1 through the garage’s own verified Paynow merchant (simulator only; real Paynow blocked)',
  IMPLEMENTED_AS_INVOICE_LINE: 'Collected as a line of a garage invoice paid through the garage’s own Paynow merchant',
  BLOCKED_GARAGE_POLICY: 'Garage money, but blocked by an unapproved garage policy or missing source (PAY-04 finding stands)',
  BLOCKED_FIRST_PARTY_NO_ZW_MERCHANT: 'CarUp first-party: blocked until an approved CarUp ZW merchant and an approved tariff exist',
  BLOCKED_CUSTODY: 'Money CarUp would hold for someone else: blocked (licensed custody required; Paynow forbids collecting on behalf)',
  BLOCKED_THIRD_PARTY_LATER_PACKAGE: 'Another party’s money under its own contract: blocked for its later payment package',
  NOT_CUSTOMER_CHECKOUT: 'Corporate treasury flow: never a customer collection (PAY-09)',
  NOT_ZIMBABWE: 'Not a Zimbabwe collection (jurisdiction)',
});

const GARAGE_FINDINGS = Object.freeze({
  'gar.invoice.customer_payment': 'IMPLEMENTED_LEVEL1',
  'gar.work_order.diagnostic_fee': 'IMPLEMENTED_AS_INVOICE_LINE',
  'gar.appointment.booking_deposit': 'BLOCKED_GARAGE_POLICY',
  'gar.parts.retail_sale': 'BLOCKED_GARAGE_POLICY',
  'gar.fleet.scheduled_maintenance': 'BLOCKED_GARAGE_POLICY',
  'gar.towing.breakdown_dispatch': 'BLOCKED_GARAGE_POLICY',
});

function dispositionOf(p) {
  if (GARAGE_FINDINGS[p.productCode]) return GARAGE_FINDINGS[p.productCode];
  if (p.commercialCategory === 'category_c_corporate_treasury') return 'NOT_CUSTOMER_CHECKOUT';
  if (p.jurisdiction !== 'ZW') return p.commercialCategory === 'category_b_third_party' ? 'BLOCKED_THIRD_PARTY_LATER_PACKAGE' : 'NOT_ZIMBABWE';
  if (p.fundsOwner === 'buyer_custodial_deposit' || p.fundsOwner === 'carup_deferred_revenue_liability'
      || p.fundsOwner === 'buyer_until_release_then_seller') return 'BLOCKED_CUSTODY';
  if (p.commercialCategory === 'category_a_first_party') return 'BLOCKED_FIRST_PARTY_NO_ZW_MERCHANT';
  return 'BLOCKED_THIRD_PARTY_LATER_PACKAGE';
}

const NEXT = Object.freeze({
  IMPLEMENTED_LEVEL1: 'Level 2: Owner + Paynow authorization, the garage’s real Paynow contract, credentials and a bounded pilot',
  IMPLEMENTED_AS_INVOICE_LINE: 'as gar.invoice.customer_payment',
  BLOCKED_GARAGE_POLICY: 'Owner / product owner (see the PAY-04 inventory)',
  BLOCKED_FIRST_PARTY_NO_ZW_MERCHANT: 'Owner: CarUp ZW legal entity and Paynow merchant account, approved tariff, merchant terms',
  BLOCKED_CUSTODY: 'PAY-08 (escrow/custody) with a licensed custodian',
  BLOCKED_THIRD_PARTY_LATER_PACKAGE: 'the product’s PAY-02 implementation owner',
  NOT_CUSTOMER_CHECKOUT: 'PAY-09',
  NOT_ZIMBABWE: 'none in PAY-05',
});

export function pay05ProductCoverage() {
  return PAY02_CATALOGUE.map((p) => {
    const disposition = dispositionOf(p);
    return {
      productCode: p.productCode,
      title: p.title,
      jurisdiction: p.jurisdiction,
      commercialCategory: p.commercialCategory,
      fundsOwner: p.fundsOwner,
      legalBeneficiary: p.legalBeneficiary,
      currencies: p.permittedCurrencies,
      tariff: p.approvedAmountMinor === null || p.approvedAmountMinor === undefined ? `none approved (${p.priceAuthorityType})` : 'approved in PAY-02',
      pay02Owner: p.implementationOwner,
      eligibleProviders: p.eligibleProviders,
      disposition,
      meaning: PAY05_DISPOSITIONS[disposition],
      next: disposition === 'BLOCKED_THIRD_PARTY_LATER_PACKAGE' ? `${p.implementationOwner}: ${NEXT[disposition]}` : NEXT[disposition],
    };
  });
}

export default { pay05ProductCoverage, PAY05_DISPOSITIONS };
