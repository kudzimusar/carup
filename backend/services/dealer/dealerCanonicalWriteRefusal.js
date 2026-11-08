/**
 * CARUP-DEALER-ONB-001-LR01-R6 B — documented HTTP refusals for the dealership
 * data-layer guards that protect CANONICAL Marketplace writes.
 *
 * The 20261103141000 triggers on `vehicles`, `vehicle_evidence`, `vehicle_seller_authority`
 * and `marketplace_inquiries` refuse a write when the dealership's authority is not current
 * (suspended, revoked, withdrawn, expired) or when the actor is not the approved owner. The
 * canonical routes (POST /api/vehicles/:vin/publish, POST /api/marketplace/inquiries) used to
 * wrap every database error as a 500. A refusal is a decision, not a fault.
 *
 * Only an EXACT guard code raised by PL/pgSQL `RAISE EXCEPTION` (SQLSTATE P0001) is
 * classified. Everything else — connection failures, constraint bugs, and the server
 * misconfiguration `DEALER_LISTING_WRITE_REQUIRES_READ_COMMITTED` — stays a genuine 5xx.
 * No route is added and the canonical gates are not bypassed: this only changes the
 * status/code a client receives for a refusal the database already made.
 */
import {CarUpError} from '../../utils/errors.js';

const CONFLICT=409, FORBIDDEN=403, UNPROCESSABLE=422;

/** Documented mapping. Keep in step with docs/dealership/R6_* and the refusal tests. */
export const DEALER_CANONICAL_WRITE_REFUSALS=Object.freeze({
  // The dealership's operating authority is not current (suspended / revoked claim /
  // withdrawn / expired legal or policy authority). State, not identity → 409.
  DEALER_LISTING_AUTHORITY_NOT_CURRENT:[CONFLICT,
    'This dealership is not currently authorised to list vehicles on CarUp.'],
  DEALER_INQUIRY_AUTHORITY_NOT_CURRENT:[CONFLICT,
    'This dealership is not currently accepting enquiries on CarUp.'],
  LISTING_ALREADY_PUBLIC_UNPUBLISH_FIRST:[CONFLICT,
    'This listing is already public; unpublish it before changing its dealership facts.'],
  VEHICLE_STATUS_NOT_LISTABLE:[CONFLICT,'This vehicle is not in a listable state.'],
  // The actor is not the approved owner / an independent reviewer → 403.
  DEALER_SELLER_RELATIONSHIP_REQUIRES_APPROVED_OWNER:[FORBIDDEN,
    'Only the approved dealership owner can be the governed seller of dealership stock.'],
  DEALER_PUBLICATION_REQUIRES_APPROVED_OWNER_SELLER:[FORBIDDEN,
    'Dealership stock can only be published with the approved owner as governed seller.'],
  DEALER_VEHICLE_EVIDENCE_REQUIRES_INDEPENDENT_REVIEWER:[FORBIDDEN,
    'Dealership vehicle evidence must be reviewed by an independent CarUp reviewer.'],
  DEALER_SELLER_AUTHORITY_REQUIRES_INDEPENDENT_REVIEWER:[FORBIDDEN,
    'Dealership seller authority must be reviewed by an independent CarUp reviewer.'],
  DEALER_TENANT_INVENTORY_REASSIGNMENT_REFUSED:[FORBIDDEN,
    'Dealership stock cannot be moved to another tenant.'],
  BRANCH_NOT_OWNED_BY_APPROVED_DEALER:[FORBIDDEN,
    'The branch does not belong to this approved dealership.'],
  // The listing lacks required dealer-declared facts → 422.
  DEALER_DECLARED_PRICE_REQUIRED:[UNPROCESSABLE,'A declared price is required before publication.'],
  DEALER_DECLARED_CURRENCY_REQUIRED:[UNPROCESSABLE,'A declared currency is required before publication.'],
  DEALER_DECLARED_LISTING_CITY_REQUIRED:[UNPROCESSABLE,'A listing city is required before publication.'],
  DEALER_DECLARED_REGISTRATION_STAGE_REQUIRED:[UNPROCESSABLE,
    'A declared registration stage is required before publication.'],
  DEALER_DECLARED_IDENTITY_NUMBERS_REQUIRED:[UNPROCESSABLE,
    'Declared vehicle identity numbers are required before publication.'],
  DEALER_LISTING_LOCATION_VISIBILITY_REQUIRED:[UNPROCESSABLE,
    'A listing location visibility choice is required before publication.'],
});

function raisedCode(error){
  if(!error||typeof error!=='object')return null;
  // PostgREST surfaces RAISE EXCEPTION as {code:'P0001', message:'<CODE>'}; node-postgres
  // as {code:'P0001', message:'<CODE>'} too. Accept nothing else.
  if(error.code!=='P0001'||typeof error.message!=='string')return null;
  const message=error.message.trim();
  return Object.hasOwn(DEALER_CANONICAL_WRITE_REFUSALS,message)?message:null;
}

/**
 * Returns a CarUpError carrying the documented 4xx status and stable `code` for a known
 * dealership guard refusal, or null so the caller keeps its existing 5xx handling.
 */
export function dealerCanonicalWriteRefusal(error){
  const code=raisedCode(error);
  if(!code)return null;
  const [status,message]=DEALER_CANONICAL_WRITE_REFUSALS[code];
  return new CarUpError(message,status,code,{refused_by:'DEALERSHIP_DATA_LAYER_GUARD'});
}
