/** C17 D7: ONLY actual vehicles belonging to an activated canonical dealer
 * tenant. This is NOT seller authority, listing publication, Vehicle Passport
 * completeness or proof of customs duties. Existing marketplace remains owner.
 */
import {supabase} from '../../db/supabase.js';
import {requireApprovedOwnerWorkspace} from './dealerVerifiedWorkspaceService.js';
import {getListingIneligibilityReasons} from '../marketplace/marketplaceListingEligibility.js';
const refuse=(code,status=503)=>Object.assign(new Error(code),{statusCode:status});
export function projectTenantDealerVehicle(record,ownerActorId=null){
  if(!record||typeof record.vin!=='string')return null;
  // R4 P0-2: a VIN is a prepared canonical listing candidate only when the approved owner is its
  // governed current seller (the data layer refuses any other seller on dealership stock).
  const prepared=typeof ownerActorId==='string'&&ownerActorId.length>0&&
    record.current_seller_id===ownerActorId;
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
    recorded_mileage:Number.isInteger(record.mileage)?record.mileage:null,
    recorded_lifecycle_state:record.status??null,
    recorded_marketplace_publication_state:record.publication_status??null,
    governed_seller_is_approved_owner:prepared,
    listing_candidate_prepared:prepared&&record.status==='Available',
    declared_price:prepared&&Number.isFinite(Number(record.price))?Number(record.price):null,
    declared_currency:prepared?record.currency??null:null,
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
    .select('vin,make,model,year,mileage,price,status,publication_status,tenant_id,owner_id,current_seller_type,import_source,current_seller_id,currency')
    .eq('tenant_id',owner.tenant_id).order('created_at',{ascending:false}).limit(100);
  // A failed/malformed data response is NOT a genuine empty inventory.
  if(error||!Array.isArray(data))
    throw refuse('CANONICAL_TENANT_INVENTORY_UNAVAILABLE');
  // Defence-in-depth against unexpectedly widened provider reads. Never
  // project foreign inventory merely because the query requested a filter.
  if(data.some(row=>row.tenant_id!==owner.tenant_id))
    throw refuse('CROSS_TENANT_VEHICLE_READ_REFUSED',403);
  const entries=data.map(row=>projectTenantDealerVehicle(row,owner.actor_id)).filter(Boolean);
  return {
    owner_tenant_id:owner.tenant_id,
    entries,
    returned_count:entries.length,
    count_scope:'FIRST_100_CANONICAL_TENANT_VEHICLES_ONLY',
    actual_total:null,
    non_tenant_vehicle_visibility:false,
    seller_publish_action_enabled:false,
    // Publication is only ever the canonical Marketplace gate; this read never decides it.
    listing_preparation_available:true,
    canonical_publication_gate_via_listing_readiness:true,
    vehicle_specific_seller_authority_requires_SELLER_DOMAIN:true,
    buyer_ratings_and_sales_counts:null,
  };
}

/**
 * C17: register only a PRIVATE canonical VIN draft. This cannot be sold,
 * published, linked to a licence, or used for financial entitlements.
 * An active approved legal owner and exact tenant membership are rechecked
 * for EVERY write. Vehicle Seller Authority remains a separate programme.
 */
const VIN17=/^[A-HJ-NPR-Z0-9]{17}$/;
const nonempty=(x,max,min=2)=>typeof x==='string'&&x.trim().length>=min&&x.trim().length<=max
  ?x.trim():null;
export function parseCanonicalDealerPrivateDraft(payload={}){
  const vin=typeof payload.vin==='string'?payload.vin.trim().toUpperCase():null;
  if(!vin||!VIN17.test(vin))throw refuse('INVALID_PRIVATE_DRAFT_VIN',400);
  const make=nonempty(payload.make,80);
  const model=nonempty(payload.model,100,1);
  const year=payload.year;
  const mileage=payload.mileage;
  if(!Number.isInteger(mileage)||mileage<0||mileage>2000000)
    throw refuse('PRIVATE_DRAFT_MILEAGE_DECLARATION_REQUIRED',400);
  if(!make||!model||!Number.isInteger(year)||
    year<1950||year>new Date().getUTCFullYear()+1)
    throw refuse('INVALID_PRIVATE_DRAFT_SPECIFICATION',400);
  // Explicit hardcoded deny-by-default; do NOT spread untrusted payload.
  return Object.freeze({vin,make,model,year,
    mileage,price:0,status:'Pending',publication_status:'draft',
    owner_id:null,current_seller_type:null,
    import_source:null,duty_paid:false,police_verified:false});
}
export async function recordMyCanonicalDealerPrivateDraft(actor,payload={},{
  db=supabase,resolveOwner=requireApprovedOwnerWorkspace,
}={}){
  const owner=await resolveOwner(actor);
  if(typeof owner?.tenant_id!=='string'||!owner.tenant_id||
    owner.actor_id!==actor?.userId)
    throw refuse('CANONICAL_OWNER_TENANT_DRAFT_AUTHORITY_REQUIRED',403);
  const clean=parseCanonicalDealerPrivateDraft(payload);
  const {data,error}=await db.from('vehicles')
    .insert({...clean,tenant_id:owner.tenant_id})
    .select('vin,tenant_id,mileage,status,publication_status,price,owner_id,current_seller_type')
    .single();
  if(error?.code==='23505')throw refuse('CANONICAL_PRIVATE_DRAFT_VIN_ALREADY_EXISTS',409);
  if(error||!data)throw refuse('CANONICAL_PRIVATE_DRAFT_WRITE_UNCONFIRMED',503);
  if(data.tenant_id!==owner.tenant_id||data.vin!==clean.vin||
    data.mileage!==clean.mileage||data.status!=='Pending'||
    data.publication_status!=='draft'||Number(data.price)!==0||
    data.owner_id!=null||data.current_seller_type!=null)
    throw refuse('CANONICAL_PRIVATE_DRAFT_READBACK_INVARIANT_FAILED',503);
  return Object.freeze({
    vin:data.vin,mileage:data.mileage,recorded_marketplace_publication_state:'draft',
    private_tenant_draft_only:true,
    legal_title_certified:false,vehicle_passport_verified:false,
    seller_publish_action_enabled:false,merchant_payment_enabled:false,
    independent_per_vin_seller_review_required:true,
  });
}

/**
 * Privately correct the data-shape of an existing tenant-bound VIN draft.
 * NEVER change its VIN, lifecycle/publication state, price, title, duty,
 * owner, seller authority or payment entitlement. SQL conditions recheck
 * the target in the SAME atomic update even after authenticated owner lookup.
 */
export function parseCanonicalDealerDraftCorrections(payload={}){
  const make=nonempty(payload.make,80);
  const model=nonempty(payload.model,100,1);
  const year=payload.year;
  const mileage=payload.mileage;
  if(!Number.isInteger(mileage)||mileage<0||mileage>2000000)
    throw refuse('PRIVATE_DRAFT_MILEAGE_DECLARATION_REQUIRED',400);
  if(!make||!model||!Number.isInteger(year)||year<1950||
    year>new Date().getUTCFullYear()+1)
    throw refuse('INVALID_PRIVATE_DRAFT_SPECIFICATION',400);
  return Object.freeze({make,model,year,mileage});
}
export async function correctMyCanonicalDealerPrivateDraft(actor,vin,payload={},{
  db=supabase,resolveOwner=requireApprovedOwnerWorkspace,
}={}){
  if(typeof vin!=='string'||!VIN17.test(vin))
    throw refuse('INVALID_PRIVATE_DRAFT_VIN',400);
  const clean=parseCanonicalDealerDraftCorrections(payload);
  const owner=await resolveOwner(actor);
  if(!owner?.tenant_id||owner.actor_id!==actor?.userId)
    throw refuse('CANONICAL_OWNER_TENANT_DRAFT_AUTHORITY_REQUIRED',403);
  const {data,error}=await db.from('vehicles').update(clean)
    .eq('vin',vin).eq('tenant_id',owner.tenant_id)
    .eq('status','Pending').eq('publication_status','draft').eq('price',0)
    .eq('duty_paid',false).eq('police_verified',false)
    .is('owner_id',null).is('current_seller_type',null).is('import_source',null)
    .select('vin,make,model,year,mileage,tenant_id,status,publication_status,price,owner_id,current_seller_type,import_source')
    .maybeSingle();
  if(error)throw refuse('CANONICAL_PRIVATE_DRAFT_UPDATE_UNAVAILABLE',503);
  if(!data)throw refuse('PRIVATE_DRAFT_NOT_FOUND_OR_NOT_EDITABLE',404);
  if(data.vin!==vin||data.tenant_id!==owner.tenant_id||
    data.status!=='Pending'||data.publication_status!=='draft'||
    Number(data.price)!==0||data.owner_id!=null||
    data.current_seller_type!=null||data.import_source!=null||
    data.make!==clean.make||data.model!==clean.model||data.year!==clean.year||
    data.mileage!==clean.mileage)
    throw refuse('CANONICAL_PRIVATE_DRAFT_UPDATE_READBACK_FAILED',503);
  return Object.freeze({vin:data.vin,make:data.make,model:data.model,year:data.year,
    mileage:data.mileage,
    private_tenant_draft_only:true,recorded_marketplace_publication_state:'draft',
    seller_publish_action_enabled:false,merchant_payment_enabled:false,
    vehicle_passport_verified:false,legal_title_certified:false});
}
