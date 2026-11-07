/**
 * C14: private, dealer-declared branch details. No publication or permissions.
 */
const deny=(code,statusCode=400)=>Object.assign(new Error(code),{code,statusCode});
const authorityKeys=[
  'id','dealer_id','dealer_profile_id','tenant_id','organization_id','claim_id',
  'public_verified','verified','compliance_status','publication_status',
  'staff_role','seller_authority'
];
function coordinate(value,min,max,code){
  if(value===null||value===undefined||value==='')return null;
  const raw=typeof value==='number'?String(value):value;
  if(typeof raw!=='string'||! /^-?\d{1,3}(?:\.\d{1,6})?$/.test(raw.trim()))
    throw deny(code);
  const n=Number(raw.trim());
  if(!Number.isFinite(n)||n<min||n>max)throw deny(code);
  return n;
}
export function parsePrivateBranchDetails(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    throw deny('BRANCH_DETAILS_OBJECT_REQUIRED');
  if(authorityKeys.some(key=>Object.hasOwn(payload,key)))
    throw deny('CLIENT_BRANCH_AUTHORITY_FIELD_REFUSED',403);
  const name=typeof payload.name==='string'?payload.name.trim():'';
  const address=typeof payload.address==='string'?payload.address.trim():'';
  if(!name||name.length>180||!address||address.length>400)
    throw deny('BRANCH_NAME_AND_ADDRESS_REQUIRED');
  const latitude=coordinate(payload.latitude,-90,90,'INVALID_BRANCH_LATITUDE');
  const longitude=coordinate(payload.longitude,-180,180,'INVALID_BRANCH_LONGITUDE');
  if((latitude===null)!==(longitude===null))throw deny('BRANCH_GPS_PAIR_REQUIRED');
  let hours=null;
  if(payload.opening_hours_text!==null&&payload.opening_hours_text!==undefined){
    if(typeof payload.opening_hours_text!=='string')throw deny('INVALID_BRANCH_OPENING_HOURS');
    const normalized=payload.opening_hours_text.trim();
    if(normalized.length>350||/[\u0000-\u001f\u007f]/.test(normalized))
      throw deny('INVALID_BRANCH_OPENING_HOURS');
    hours=normalized||null;
  }
  return Object.freeze({name,address,latitude,longitude,opening_hours_text:hours});
}
