/**
 * C24 D9: Truthful safe dealer-commerce readiness until PAY-03B/05 source
 * authorities are actually converged and independently accepted. No fake
 * prices, no fake payments, no second money ledger and no provider API calls.
 */
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';
export const FLOW_DISTINCTIONS=Object.freeze([
  Object.freeze({
    code:'DEALER_PAYS_CARUP',payer:'DEALERSHIP_ORGANIZATION',
    beneficiary:'INDEPENDENTLY_APPROVED_CARUP_MERCHANT',
    provider:'SEPARATE_FIRST_PARTY_CHECKOUT_TO_BE_CERTIFIED',
    status:'BLOCKED_PENDING_PAY03B_AND_FIRST_PARTY_MERCHANT',
    paid:false,
  }),
  Object.freeze({
    code:'BUYER_PAYS_DEALER',payer:'END_CUSTOMER',
    beneficiary:'THIS_DEALERSHIP_OWN_VERIFIED_MERCHANT',
    provider:'SEPARATELY_AUTHORIZED_DEALER_COLLECTIONS',
    status:'BLOCKED_PENDING_DEALER_MERCHANT_AND_PROVIDER_CERT',
    paid:false,
  }),
  Object.freeze({
    code:'GARAGE_CUSTOMER_PAYS_GARAGE',payer:'GARAGE_CUSTOMER',
    beneficiary:'GARAGE_OWN_MERCHANT_NOT_CARUP_AND_NOT_DEALERSHIP',
    provider:'PAY05_GARAGE_LINEAGE_UNMERGED',
    status:'OUTSIDE_DEALER_BILLING_SCOPE',
    paid:false,
  }),
]);
export async function getDealerCommercialReadiness(actor){
  const owner=await requireApprovedOwnerWorkspace(actor);
  // The current base deliberately lacks deployed PAY-03B and PAY-05 product
  // authorizations. A UI must never treat this truthful unpriced state as
  // payment history, a real-money provider entitlement or a plan selection.
  return {
    organization_id:owner.organization_id,tenant_id:owner.tenant_id,
    product_catalogue_authority:'PAY03B_DRAFT_PR_251_NOT_IN_ACCEPTED_MAIN',
    dealer_first_party_pricing:[],
    selectable_dealer_plans:[],
    approved_provider_methods:[],
    billing_transactions:null,
    receipts:null,
    reconciliation_records:null,
    payment_initiation_allowed:false,
    has_approved_subscription_entitlement:false,
    live_payment_enabled:false,
    finance_status:'INTEGRATION_AND_EXTERNAL_COMMERCIAL_APPROVAL_REQUIRED',
    external_gates:[
      'OWNER_APPROVED_DEALER_PRODUCT_TARIFF_AND_JURISDICTION',
      'APPROVED_CARUP_LEGAL_MERCHANT_OF_RECORD',
      'PAY03B_CANONICAL_ENTITLEMENT_AND_FINANCE_CONVERGENCE',
      'PAY05_GARAGE_COLLECTIONS_MUST_REMAIN_SEPARATE',
      'INDEPENDENT_PROVIDER_SANDBOX_AND_SECURITY_CERTIFICATION',
      'EXPLICIT_OWNER_NO_LIVE_ACTIVATION_RELEASE',
    ],
    flows:FLOW_DISTINCTIONS,
  };
}
