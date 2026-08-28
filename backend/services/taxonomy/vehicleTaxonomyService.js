import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH=path.resolve(__dirname,'../../../shared/taxonomy/vehicle/catalog.json');
let _catalog=null;
export function getVehicleTaxonomyCatalog(){if(_catalog)return _catalog;_catalog=JSON.parse(fs.readFileSync(CATALOG_PATH,'utf8'));return _catalog}
export function resetVehicleTaxonomyCatalogForTests(){_catalog=null}
function norm(value){return value==null?'':String(value).trim().toLocaleLowerCase()}
function resolveDimension(dimension,raw){
  const value=norm(raw);if(!value)return {state:'not_recorded',raw:null,canonical_id:null,canonical_label:null};
  const entries=getVehicleTaxonomyCatalog().dimensions?.[dimension]||[];
  for(const entry of entries){
    if(norm(entry.label)===value)return {state:'canonical',raw:String(raw).trim(),canonical_id:entry.id,canonical_label:entry.label};
    if((entry.aliases||[]).some(alias=>norm(alias)===value))return {state:'alias_match',raw:String(raw).trim(),canonical_id:entry.id,canonical_label:entry.label};
  }
  return {state:'unrecognized',raw:String(raw).trim(),canonical_id:null,canonical_label:null};
}
export function resolveVehicleMake(raw){
  const value=norm(raw);if(!value)return {state:'not_recorded',raw:null,canonical_id:null,canonical_label:null};
  for(const make of getVehicleTaxonomyCatalog().makes||[]){
    if(norm(make.name)===value)return {state:'canonical',raw:String(raw).trim(),canonical_id:make.id,canonical_label:make.name};
    if((make.aliases||[]).some(alias=>norm(alias)===value))return {state:'alias_match',raw:String(raw).trim(),canonical_id:make.id,canonical_label:make.name};
  }
  return {state:'unrecognized',raw:String(raw).trim(),canonical_id:null,canonical_label:null};
}
export function resolveVehicleModel(makeRaw,modelRaw){
  const make=resolveVehicleMake(makeRaw),value=norm(modelRaw);
  if(!value)return {state:'not_recorded',raw:null,canonical_id:null,canonical_label:null,make};
  const makeEntry=(getVehicleTaxonomyCatalog().makes||[]).find(item=>item.id===make.canonical_id);
  if(!makeEntry)return {state:'unrecognized',raw:String(modelRaw).trim(),canonical_id:null,canonical_label:null,make};
  for(const model of makeEntry.models||[]){
    if(norm(model.name)===value)return {state:'canonical',raw:String(modelRaw).trim(),canonical_id:model.id,canonical_label:model.name,make};
    if((model.aliases||[]).some(alias=>norm(alias)===value))return {state:'alias_match',raw:String(modelRaw).trim(),canonical_id:model.id,canonical_label:model.name,make};
  }
  return {state:'unrecognized',raw:String(modelRaw).trim(),canonical_id:null,canonical_label:null,make};
}
export const resolveFuelType=raw=>resolveDimension('fuelTypes',raw);
export const resolveTransmission=raw=>resolveDimension('transmissions',raw);
export const resolveDrivetrain=raw=>resolveDimension('drivetrains',raw);
export const resolveBodyStyle=raw=>resolveDimension('bodyStyles',raw);
export const resolveSellerCondition=raw=>resolveDimension('sellerConditions',raw);
export function vehicleYearBounds(now=new Date()){const p=getVehicleTaxonomyCatalog().yearPolicy;return {min:p.technicalMin,max:now.getFullYear()+p.maxOffsetFromCurrentYear}}
export function resolveVehicleYear(raw,now=new Date()){
  if(raw==null||raw==='')return {state:'not_recorded',raw:null,canonical_year:null};
  const year=Number(raw),{min,max}=vehicleYearBounds(now);
  return Number.isInteger(year)&&year>=min&&year<=max?{state:'canonical',raw:String(raw).trim(),canonical_year:year}:{state:'unrecognized',raw:String(raw).trim(),canonical_year:null};
}
export function normalizeVehicleTaxonomyInput(input={}){
  return {
    taxonomy_version:getVehicleTaxonomyCatalog().version,
    make:resolveVehicleMake(input.make),
    model:resolveVehicleModel(input.make,input.model),
    year:resolveVehicleYear(input.year),
    fuel:resolveFuelType(input.fuel_type),
    transmission:resolveTransmission(input.transmission),
    drivetrain:resolveDrivetrain(input.drivetrain),
    body_style:resolveBodyStyle(input.body_style??input.category),
    seller_condition:resolveSellerCondition(input.seller_stated_condition??input.condition),
  };
}
