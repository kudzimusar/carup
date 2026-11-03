/** C17 D7: ONLY actual vehicles belonging to an activated canonical dealer
 * tenant. This is NOT seller authority, listing publication, Vehicle Passport
 * completeness or proof of customs duties. Existing marketplace remains owner.
 */
import {supabase} from '../../db/supabase.js';
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';
const refuse=(code,status=503)=>Object.assign(new Error(code),{statusCode:status});
export function projectTenantDealerVehicle(record){
  if(!record||typeof record.vin!=='string')return null;
  return Object.freeze({
    vin:record.vin,make:record.make??null,model:record.model??null,
    year:Number.isInteger(record.year)?record.year:null,
    recorded_lifecycle_state:record.status??null,
    recorded_marketplace_publication_state:record.publication_status??null,
    seller_authority:'NOT_DETERMINED_BY_TENANT_INVENTORY_READ',
    legal_title_certified:false,import_duty_verified:false,
    branch_attribution:'NOT_VERIFIED_IN_CANONICAL_STOCK',
    public_listing_approved_by_this_read:false,
  });
}
export async function getMyCanonicalDealerInventory(actor){
  const owner=await requireApprovedOwnerWorkspace(actor);
  const {data,error}=await supabase.from('vehicles')
    .select('vin,make,model,year,status,publication_status,tenant_id')
    .eq('tenant_id',owner.tenant_id).order('created_at',{ascending:false}).limit(100);
  if(error)throw refuse('CANONICAL_TENANT_INVENTORY_UNAVAILABLE');
  const entries=(data||[]).map(projectTenantDealerVehicle).filter(Boolean);
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
