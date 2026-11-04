/** C17 D7: ONLY actual vehicles belonging to an activated canonical dealer
 * tenant. This is NOT seller authority, listing publication, Vehicle Passport
 * completeness or proof of customs duties. Existing marketplace remains owner.
 */
import {supabase} from '../../db/supabase.js';
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';
import {getListingIneligibilityReasons} from '../marketplace/marketplaceListingEligibility.js';
const refuse=(code,status=503)=>Object.assign(new Error(code),{statusCode:status});
export function projectTenantDealerVehicle(record){
  if(!record||typeof record.vin!=='string')return null;
  // This calls the EXISTING read-only Marketplace structural rules. It is NOT
  // Seller Authority, a reviewer decision, a price/value guarantee or an
  // unlockable publish button. Never return owner_id, tenant_id or other PII.
  // The very same persisted VIN row drives this check; no user-supplied
  // "verified" booleans or fake fallback vehicles are permitted.
  const blockers=getListingIneligibilityReasons({
    vin:record.vin,make:record.make,model:record.model,
    year:record.year,price:record.price,status:record.status,
    owner_id:record.owner_id,tenant_id:record.tenant_id,
    current_seller_type:record.current_seller_type,
    import_source:record.import_source,
  });
  return Object.freeze({
    vin:record.vin,make:record.make??null,model:record.model??null,
    year:Number.isInteger(record.year)?record.year:null,
    recorded_lifecycle_state:record.status??null,
    recorded_marketplace_publication_state:record.publication_status??null,
    seller_authority:'NOT_DETERMINED_BY_TENANT_INVENTORY_READ',
    legal_title_certified:false,import_duty_verified:false,
    branch_attribution:'NOT_VERIFIED_IN_CANONICAL_STOCK',
    public_listing_approved_by_this_read:false,
    // Even zero structural blockers cannot confer ownership, sale rights or
    // media/trust/country status. These reasons are advisory inputs for a
    // separate genuine per-VIN Seller Authority review.
    listing_structural_precheck:Object.freeze({
      source:'EXISTING_MARKETPLACE_LISTING_ELIGIBILITY_RULES',
      blocking_reason_codes:Object.freeze([...blockers]),
      result:blockers.length===0?'DATA_PRECHECK_ONLY':'REQUIRES_DATA_CORRECTION',
      seller_authority_check:'NOT_EVALUATED',
      vehicle_passport_review:'NOT_EVALUATED',
      human_publication_authorized:false,
      merchant_payment_authorized:false,
    }),
  });
}
export async function getMyCanonicalDealerInventory(actor,{
  db=supabase,resolveOwner=requireApprovedOwnerWorkspace,
}={}){
  const owner=await resolveOwner(actor);
  if(typeof owner?.tenant_id!=='string'||!owner.tenant_id)
    throw refuse('CANONICAL_TENANT_CONTEXT_REQUIRED',403);
  const {data,error}=await db.from('vehicles')
    .select('vin,make,model,year,price,status,publication_status,tenant_id,owner_id,current_seller_type,import_source')
    .eq('tenant_id',owner.tenant_id).order('created_at',{ascending:false}).limit(100);
  // A failed/malformed data response is NOT a genuine empty inventory.
  if(error||!Array.isArray(data))
    throw refuse('CANONICAL_TENANT_INVENTORY_UNAVAILABLE');
  // Defence-in-depth against unexpectedly widened provider reads. Never
  // project foreign inventory merely because the query requested a filter.
  if(data.some(row=>row.tenant_id!==owner.tenant_id))
    throw refuse('CROSS_TENANT_VEHICLE_READ_REFUSED',403);
  const entries=data.map(projectTenantDealerVehicle).filter(Boolean);
  return {
    owner_tenant_id:owner.tenant_id,
    entries,
    returned_count:entries.length,
    count_scope:'FIRST_100_CANONICAL_TENANT_VEHICLES_ONLY',
    actual_total:null,
    non_tenant_vehicle_visibility:false,
    seller_publish_action_enabled:false,
    vehicle_specific_seller_authority_requires_SELLER_DOMAIN:true,
    buyer_ratings_and_sales_counts:null,
  };
}
