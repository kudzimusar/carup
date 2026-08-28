import rawCatalog from './catalog.json'

export type TaxonomyResolutionState = 'canonical' | 'alias_match' | 'unrecognized' | 'not_recorded'
export interface VehicleModelTaxon { id: string; name: string; aliases?: string[]; bodyStyles?: string[]; generations?: unknown[] }
export interface VehicleMakeTaxon { id: string; make: string; aliases?: string[]; models: VehicleModelTaxon[] }
interface DimensionValue { id: string; label: string; aliases?: string[] }
interface CatalogModel { id: string; name: string; aliases?: string[]; bodyStyleIds?: string[]; generations?: unknown[] }
interface CatalogMake { id: string; name: string; aliases?: string[]; models: CatalogModel[] }
interface VehicleTaxonomyCatalog {
  version: string
  yearPolicy: { technicalMin: number; maxOffsetFromCurrentYear: number }
  dimensions: { bodyStyles: DimensionValue[]; colors: DimensionValue[]; fuelTypes: DimensionValue[]; transmissions: DimensionValue[]; drivetrains: DimensionValue[]; sellerConditions: DimensionValue[] }
  makes: CatalogMake[]
}
const CATALOG = rawCatalog as VehicleTaxonomyCatalog
export const VEHICLE_TAXONOMY_VERSION = CATALOG.version
export const GLOBAL_VEHICLE_TAXONOMY_VERSION = CATALOG.version
export const VEHICLE_YEAR_MIN = CATALOG.yearPolicy.technicalMin
export const VEHICLE_YEAR_MAX_OFFSET = CATALOG.yearPolicy.maxOffsetFromCurrentYear
const labels = (values: DimensionValue[]) => values.map(value => value.label)
export const BODY_STYLES = labels(CATALOG.dimensions.bodyStyles)
export const VEHICLE_COLORS = labels(CATALOG.dimensions.colors)
export const FUEL_TYPES = labels(CATALOG.dimensions.fuelTypes)
export const TRANSMISSIONS = labels(CATALOG.dimensions.transmissions)
export const DRIVETRAINS = labels(CATALOG.dimensions.drivetrains)
export const SELLER_CONDITIONS = labels(CATALOG.dimensions.sellerConditions)
const bodyStyleLabel = new Map(CATALOG.dimensions.bodyStyles.map(value => [value.id, value.label]))
export const VEHICLE_TAXONOMY: VehicleMakeTaxon[] = CATALOG.makes.map(make => ({
  id: make.id, make: make.name, aliases: make.aliases || [],
  models: make.models.map(model => ({ id: model.id, name: model.name, aliases: model.aliases || [], bodyStyles: (model.bodyStyleIds || []).map(id => bodyStyleLabel.get(id) || id), generations: model.generations || [] })),
}))
export const VEHICLE_MAKES = VEHICLE_TAXONOMY.map(item => item.make)
function normalized(value: string | null | undefined) { return (value || '').trim().toLocaleLowerCase() }
export function makeTaxon(make: string | null | undefined) {
  const value=normalized(make); if(!value) return null
  return VEHICLE_TAXONOMY.find(item => normalized(item.make)===value || (item.aliases||[]).some(alias=>normalized(alias)===value)) || null
}
export function modelsForMake(make: string | null | undefined) { return makeTaxon(make)?.models || [] }
export function canonicalMake(value: string) { return makeTaxon(value)?.make || value.trim() }
export function canonicalModel(make: string, value: string) {
  const wanted=normalized(value)
  const match=modelsForMake(make).find(item=>normalized(item.name)===wanted || (item.aliases||[]).some(alias=>normalized(alias)===wanted))
  return match?.name || value.trim()
}
export function taxonomySearchTerms(make: string, model?: string) {
  const makeEntry=makeTaxon(make); if(!makeEntry) return [make,model].filter(Boolean) as string[]
  const wanted=normalized(model)
  const modelEntry=model ? makeEntry.models.find(item=>normalized(item.name)===wanted || (item.aliases||[]).some(alias=>normalized(alias)===wanted)) : null
  return [makeEntry.make,...(makeEntry.aliases||[]),...(modelEntry?[modelEntry.name,...(modelEntry.aliases||[])]:[])]
}
function resolveDimension(values: DimensionValue[], raw: string | null | undefined) {
  const value=normalized(raw); if(!value) return {state:'not_recorded' as const,value:null,id:null,raw:null}
  for(const item of values){
    if(normalized(item.label)===value) return {state:'canonical' as const,value:item.label,id:item.id,raw:raw!.trim()}
    if((item.aliases||[]).some(alias=>normalized(alias)===value)) return {state:'alias_match' as const,value:item.label,id:item.id,raw:raw!.trim()}
  }
  return {state:'unrecognized' as const,value:raw!.trim(),id:null,raw:raw!.trim()}
}
export const resolveColor=(value:string|null|undefined)=>resolveDimension(CATALOG.dimensions.colors,value)
export const resolveFuelType=(value:string|null|undefined)=>resolveDimension(CATALOG.dimensions.fuelTypes,value)
export const resolveTransmission=(value:string|null|undefined)=>resolveDimension(CATALOG.dimensions.transmissions,value)
export const resolveDrivetrain=(value:string|null|undefined)=>resolveDimension(CATALOG.dimensions.drivetrains,value)
export const resolveBodyStyle=(value:string|null|undefined)=>resolveDimension(CATALOG.dimensions.bodyStyles,value)
export const resolveSellerCondition=(value:string|null|undefined)=>resolveDimension(CATALOG.dimensions.sellerConditions,value)
export function vehicleYearBounds(now=new Date()){return {min:VEHICLE_YEAR_MIN,max:now.getFullYear()+VEHICLE_YEAR_MAX_OFFSET}}
export function isValidVehicleYear(value:string|number|null|undefined,now=new Date()){
  if(value===null||value===undefined||value==='') return false
  const year=Number(value),{min,max}=vehicleYearBounds(now); return Number.isInteger(year)&&year>=min&&year<=max
}
export function vehicleYearOptions(now=new Date()){
  const {min,max}=vehicleYearBounds(now); return Array.from({length:max-min+1},(_,index)=>String(max-index))
}
