/**
 * CarUp vehicle taxonomy v1.
 *
 * This is a discovery/listing vocabulary, not a claim that every model is currently for sale or
 * that the list is globally exhaustive. Marketplace inventory facets remain server-derived.
 */
export interface VehicleModelTaxon {
  name: string
  aliases?: string[]
  bodyStyles?: string[]
}

export interface VehicleMakeTaxon {
  make: string
  aliases?: string[]
  models: VehicleModelTaxon[]
}

export const VEHICLE_TAXONOMY_VERSION = 'carup-vehicle-taxonomy-1.0.0'

export const BODY_STYLES = [
  'Sedan', 'Hatchback', 'SUV', 'Crossover', 'Pickup', 'Wagon', 'Coupe',
  'Convertible', 'Van', 'Minibus', 'Bus', 'Truck', 'Commercial', 'Other',
] as const

export const VEHICLE_COLORS = [
  'Black', 'White', 'Silver', 'Grey', 'Blue', 'Red', 'Green', 'Brown',
  'Beige', 'Gold', 'Orange', 'Yellow', 'Purple', 'Maroon', 'Bronze', 'Other',
] as const

export const VEHICLE_TAXONOMY: VehicleMakeTaxon[] = [
  { make: 'Toyota', models: [
    { name: 'Hilux', bodyStyles: ['Pickup'] }, { name: 'Corolla', bodyStyles: ['Sedan','Hatchback','Wagon'] },
    { name: 'Fortuner', bodyStyles: ['SUV'] }, { name: 'Land Cruiser', aliases: ['LC'], bodyStyles: ['SUV'] },
    { name: 'Prado', aliases: ['Land Cruiser Prado'], bodyStyles: ['SUV'] }, { name: 'RAV4', bodyStyles: ['SUV','Crossover'] },
    { name: 'Aqua', aliases: ['Prius C'], bodyStyles: ['Hatchback'] }, { name: 'Prius', bodyStyles: ['Hatchback','Sedan'] },
    { name: 'Vitz', aliases: ['Yaris'], bodyStyles: ['Hatchback'] }, { name: 'Wish', bodyStyles: ['Wagon'] },
    { name: 'Noah', bodyStyles: ['Van'] }, { name: 'Voxy', bodyStyles: ['Van'] }, { name: 'HiAce', bodyStyles: ['Van','Minibus'] },
    { name: 'Harrier', bodyStyles: ['SUV'] }, { name: 'C-HR', bodyStyles: ['Crossover'] }, { name: 'Probox', bodyStyles: ['Wagon','Commercial'] },
  ]},
  { make: 'Nissan', models: [
    { name: 'NP200', bodyStyles: ['Pickup'] }, { name: 'Navara', bodyStyles: ['Pickup'] }, { name: 'X-Trail', bodyStyles: ['SUV'] },
    { name: 'Qashqai', bodyStyles: ['Crossover'] }, { name: 'Note', bodyStyles: ['Hatchback'] }, { name: 'Tiida', bodyStyles: ['Hatchback','Sedan'] },
    { name: 'March', aliases: ['Micra'], bodyStyles: ['Hatchback'] }, { name: 'Juke', bodyStyles: ['Crossover'] },
    { name: 'Serena', bodyStyles: ['Van'] }, { name: 'Patrol', bodyStyles: ['SUV'] }, { name: 'NV200', bodyStyles: ['Van','Commercial'] },
  ]},
  { make: 'Honda', models: [
    { name: 'Fit', aliases: ['Jazz'], bodyStyles: ['Hatchback'] }, { name: 'CR-V', bodyStyles: ['SUV'] },
    { name: 'Vezel', aliases: ['HR-V'], bodyStyles: ['Crossover'] }, { name: 'Civic', bodyStyles: ['Sedan','Hatchback'] },
    { name: 'Accord', bodyStyles: ['Sedan'] }, { name: 'Freed', bodyStyles: ['Van'] }, { name: 'Stepwgn', aliases: ['Step Wagon'], bodyStyles: ['Van'] },
  ]},
  { make: 'Mazda', models: [
    { name: 'Demio', aliases: ['Mazda2'], bodyStyles: ['Hatchback'] }, { name: 'Axela', aliases: ['Mazda3'], bodyStyles: ['Sedan','Hatchback'] },
    { name: 'Atenza', aliases: ['Mazda6'], bodyStyles: ['Sedan','Wagon'] }, { name: 'CX-3', bodyStyles: ['Crossover'] },
    { name: 'CX-5', bodyStyles: ['SUV'] }, { name: 'CX-30', bodyStyles: ['Crossover'] }, { name: 'BT-50', bodyStyles: ['Pickup'] },
  ]},
  { make: 'Ford', models: [
    { name: 'Ranger', bodyStyles: ['Pickup'] }, { name: 'Everest', bodyStyles: ['SUV'] }, { name: 'EcoSport', bodyStyles: ['Crossover'] },
    { name: 'Kuga', bodyStyles: ['SUV'] }, { name: 'Focus', bodyStyles: ['Hatchback','Sedan'] }, { name: 'Fiesta', bodyStyles: ['Hatchback'] },
    { name: 'Transit', bodyStyles: ['Van','Commercial'] },
  ]},
  { make: 'Isuzu', models: [
    { name: 'D-Max', bodyStyles: ['Pickup'] }, { name: 'KB', bodyStyles: ['Pickup'] }, { name: 'MU-X', bodyStyles: ['SUV'] }, { name: 'N-Series', bodyStyles: ['Truck'] },
  ]},
  { make: 'Mitsubishi', models: [
    { name: 'Triton', aliases: ['L200'], bodyStyles: ['Pickup'] }, { name: 'Pajero', bodyStyles: ['SUV'] },
    { name: 'Outlander', bodyStyles: ['SUV'] }, { name: 'ASX', bodyStyles: ['Crossover'] }, { name: 'Delica', bodyStyles: ['Van'] },
  ]},
  { make: 'Subaru', models: [
    { name: 'Impreza', bodyStyles: ['Sedan','Hatchback'] }, { name: 'Forester', bodyStyles: ['SUV'] },
    { name: 'XV', aliases: ['Crosstrek'], bodyStyles: ['Crossover'] }, { name: 'Legacy', bodyStyles: ['Sedan','Wagon'] },
    { name: 'Outback', bodyStyles: ['Wagon'] }, { name: 'Levorg', bodyStyles: ['Wagon'] },
  ]},
  { make: 'Suzuki', models: [
    { name: 'Swift', bodyStyles: ['Hatchback'] }, { name: 'Jimny', bodyStyles: ['SUV'] }, { name: 'Vitara', bodyStyles: ['SUV'] },
    { name: 'Ertiga', bodyStyles: ['Van'] }, { name: 'Baleno', bodyStyles: ['Hatchback'] }, { name: 'S-Presso', bodyStyles: ['Hatchback'] },
  ]},
  { make: 'Volkswagen', aliases: ['VW'], models: [
    { name: 'Polo', bodyStyles: ['Hatchback','Sedan'] }, { name: 'Golf', bodyStyles: ['Hatchback'] }, { name: 'Amarok', bodyStyles: ['Pickup'] },
    { name: 'Tiguan', bodyStyles: ['SUV'] }, { name: 'T-Cross', bodyStyles: ['Crossover'] }, { name: 'Passat', bodyStyles: ['Sedan','Wagon'] },
    { name: 'Caddy', bodyStyles: ['Van','Commercial'] }, { name: 'Transporter', bodyStyles: ['Van','Commercial'] },
  ]},
  { make: 'Mercedes-Benz', aliases: ['Mercedes','Benz'], models: [
    { name: 'A-Class', bodyStyles: ['Hatchback','Sedan'] }, { name: 'C-Class', bodyStyles: ['Sedan','Coupe'] },
    { name: 'E-Class', bodyStyles: ['Sedan','Wagon'] }, { name: 'S-Class', bodyStyles: ['Sedan'] }, { name: 'GLA', bodyStyles: ['Crossover'] },
    { name: 'GLC', bodyStyles: ['SUV'] }, { name: 'GLE', bodyStyles: ['SUV'] }, { name: 'G-Class', aliases: ['G-Wagon'], bodyStyles: ['SUV'] },
    { name: 'Vito', bodyStyles: ['Van'] }, { name: 'Sprinter', bodyStyles: ['Van','Commercial'] },
  ]},
  { make: 'BMW', models: [
    { name: '1 Series', bodyStyles: ['Hatchback'] }, { name: '3 Series', bodyStyles: ['Sedan','Wagon'] }, { name: '5 Series', bodyStyles: ['Sedan','Wagon'] },
    { name: 'X1', bodyStyles: ['Crossover'] }, { name: 'X3', bodyStyles: ['SUV'] }, { name: 'X5', bodyStyles: ['SUV'] }, { name: 'X6', bodyStyles: ['SUV'] },
  ]},
  { make: 'Audi', models: [
    { name: 'A1', bodyStyles: ['Hatchback'] }, { name: 'A3', bodyStyles: ['Sedan','Hatchback'] }, { name: 'A4', bodyStyles: ['Sedan','Wagon'] },
    { name: 'A6', bodyStyles: ['Sedan','Wagon'] }, { name: 'Q3', bodyStyles: ['Crossover'] }, { name: 'Q5', bodyStyles: ['SUV'] }, { name: 'Q7', bodyStyles: ['SUV'] },
  ]},
  { make: 'Land Rover', models: [
    { name: 'Defender', bodyStyles: ['SUV'] }, { name: 'Discovery', bodyStyles: ['SUV'] }, { name: 'Discovery Sport', bodyStyles: ['SUV'] },
    { name: 'Range Rover', bodyStyles: ['SUV'] }, { name: 'Range Rover Sport', bodyStyles: ['SUV'] }, { name: 'Range Rover Evoque', bodyStyles: ['SUV'] },
  ]},
  { make: 'Hyundai', models: [
    { name: 'i10', bodyStyles: ['Hatchback'] }, { name: 'i20', bodyStyles: ['Hatchback'] }, { name: 'Elantra', bodyStyles: ['Sedan'] },
    { name: 'Tucson', bodyStyles: ['SUV'] }, { name: 'Santa Fe', bodyStyles: ['SUV'] }, { name: 'H-1', bodyStyles: ['Van'] },
  ]},
  { make: 'Kia', models: [
    { name: 'Picanto', bodyStyles: ['Hatchback'] }, { name: 'Rio', bodyStyles: ['Hatchback','Sedan'] }, { name: 'Cerato', bodyStyles: ['Sedan'] },
    { name: 'Seltos', bodyStyles: ['Crossover'] }, { name: 'Sportage', bodyStyles: ['SUV'] }, { name: 'Sorento', bodyStyles: ['SUV'] },
  ]},
  { make: 'Chevrolet', models: [
    { name: 'Spark', bodyStyles: ['Hatchback'] }, { name: 'Aveo', bodyStyles: ['Sedan','Hatchback'] }, { name: 'Cruze', bodyStyles: ['Sedan'] },
    { name: 'Trailblazer', bodyStyles: ['SUV'] }, { name: 'Captiva', bodyStyles: ['SUV'] },
  ]},
  { make: 'Renault', models: [
    { name: 'Kwid', bodyStyles: ['Hatchback'] }, { name: 'Clio', bodyStyles: ['Hatchback'] }, { name: 'Duster', bodyStyles: ['SUV'] },
    { name: 'Koleos', bodyStyles: ['SUV'] }, { name: 'Master', bodyStyles: ['Van','Commercial'] },
  ]},
  { make: 'Peugeot', models: [
    { name: '208', bodyStyles: ['Hatchback'] }, { name: '308', bodyStyles: ['Hatchback','Wagon'] }, { name: '2008', bodyStyles: ['Crossover'] },
    { name: '3008', bodyStyles: ['SUV'] }, { name: '5008', bodyStyles: ['SUV'] }, { name: 'Boxer', bodyStyles: ['Van','Commercial'] },
  ]},
  { make: 'Jeep', models: [
    { name: 'Renegade', bodyStyles: ['Crossover'] }, { name: 'Compass', bodyStyles: ['SUV'] }, { name: 'Cherokee', bodyStyles: ['SUV'] },
    { name: 'Grand Cherokee', bodyStyles: ['SUV'] }, { name: 'Wrangler', bodyStyles: ['SUV'] },
  ]},
  { make: 'Volvo', models: [
    { name: 'S60', bodyStyles: ['Sedan'] }, { name: 'S90', bodyStyles: ['Sedan'] }, { name: 'V60', bodyStyles: ['Wagon'] },
    { name: 'XC40', bodyStyles: ['Crossover'] }, { name: 'XC60', bodyStyles: ['SUV'] }, { name: 'XC90', bodyStyles: ['SUV'] },
  ]},
  { make: 'Lexus', models: [
    { name: 'IS', bodyStyles: ['Sedan'] }, { name: 'ES', bodyStyles: ['Sedan'] }, { name: 'GS', bodyStyles: ['Sedan'] },
    { name: 'NX', bodyStyles: ['SUV'] }, { name: 'RX', bodyStyles: ['SUV'] }, { name: 'LX', bodyStyles: ['SUV'] },
  ]},
  { make: 'Daihatsu', models: [
    { name: 'Mira', bodyStyles: ['Hatchback'] }, { name: 'Move', bodyStyles: ['Hatchback'] }, { name: 'Tanto', bodyStyles: ['Hatchback'] },
    { name: 'Terios', bodyStyles: ['SUV'] },
  ]},
  { make: 'Hino', models: [{ name: '300', bodyStyles: ['Truck'] }, { name: '500', bodyStyles: ['Truck'] }, { name: '700', bodyStyles: ['Truck'] }]},
  { make: 'Fuso', aliases: ['Mitsubishi Fuso'], models: [{ name: 'Canter', bodyStyles: ['Truck'] }, { name: 'Fighter', bodyStyles: ['Truck'] }]},
  { make: 'UD Trucks', aliases: ['Nissan Diesel'], models: [{ name: 'Quon', bodyStyles: ['Truck'] }, { name: 'Condor', bodyStyles: ['Truck'] }]},
  { make: 'Scania', models: [{ name: 'P-Series', bodyStyles: ['Truck'] }, { name: 'G-Series', bodyStyles: ['Truck'] }, { name: 'R-Series', bodyStyles: ['Truck'] }]},
  { make: 'MAN', models: [{ name: 'TGL', bodyStyles: ['Truck'] }, { name: 'TGM', bodyStyles: ['Truck'] }, { name: 'TGX', bodyStyles: ['Truck'] }]},
  { make: 'Iveco', models: [{ name: 'Daily', bodyStyles: ['Van','Commercial'] }, { name: 'Eurocargo', bodyStyles: ['Truck'] }]},
  { make: 'JAC', models: [{ name: 'T8', bodyStyles: ['Pickup'] }, { name: 'T9', bodyStyles: ['Pickup'] }, { name: 'N-Series', bodyStyles: ['Truck'] }]},
  { make: 'GWM', aliases: ['Great Wall'], models: [{ name: 'P-Series', aliases: ['P-Series Pickup'], bodyStyles: ['Pickup'] }, { name: 'Steed', bodyStyles: ['Pickup'] }]},
  { make: 'Haval', models: [{ name: 'Jolion', bodyStyles: ['Crossover'] }, { name: 'H6', bodyStyles: ['SUV'] }, { name: 'H9', bodyStyles: ['SUV'] }]},
  { make: 'Chery', models: [{ name: 'Tiggo 4', bodyStyles: ['Crossover'] }, { name: 'Tiggo 7', bodyStyles: ['SUV'] }, { name: 'Tiggo 8', bodyStyles: ['SUV'] }]},
  { make: 'BYD', models: [{ name: 'Dolphin', bodyStyles: ['Hatchback'] }, { name: 'Atto 3', bodyStyles: ['Crossover'] }, { name: 'Seal', bodyStyles: ['Sedan'] }]},
  { make: 'Geely', models: [{ name: 'Coolray', bodyStyles: ['Crossover'] }, { name: 'Emgrand', bodyStyles: ['Sedan'] }, { name: 'Okavango', bodyStyles: ['SUV'] }]},
  { make: 'Mahindra', models: [{ name: 'Scorpio', bodyStyles: ['SUV'] }, { name: 'Pik Up', bodyStyles: ['Pickup'] }, { name: 'XUV700', bodyStyles: ['SUV'] }]},
  { make: 'Tata', models: [{ name: 'Xenon', bodyStyles: ['Pickup'] }, { name: 'Nexon', bodyStyles: ['Crossover'] }, { name: 'Ace', bodyStyles: ['Commercial'] }]},
  { make: 'Opel', models: [{ name: 'Corsa', bodyStyles: ['Hatchback'] }, { name: 'Astra', bodyStyles: ['Hatchback','Sedan'] }, { name: 'Mokka', bodyStyles: ['Crossover'] }]},
  { make: 'Citroën', aliases: ['Citroen'], models: [{ name: 'C3', bodyStyles: ['Hatchback'] }, { name: 'C4', bodyStyles: ['Hatchback'] }, { name: 'Berlingo', bodyStyles: ['Van'] }]},
  { make: 'Fiat', models: [{ name: '500', bodyStyles: ['Hatchback'] }, { name: 'Panda', bodyStyles: ['Hatchback'] }, { name: 'Ducato', bodyStyles: ['Van','Commercial'] }]},
  { make: 'Porsche', models: [{ name: 'Cayenne', bodyStyles: ['SUV'] }, { name: 'Macan', bodyStyles: ['SUV'] }, { name: '911', bodyStyles: ['Coupe','Convertible'] }]},
  { make: 'Jaguar', models: [{ name: 'XE', bodyStyles: ['Sedan'] }, { name: 'XF', bodyStyles: ['Sedan'] }, { name: 'F-Pace', bodyStyles: ['SUV'] }]},
  { make: 'Mini', aliases: ['MINI'], models: [{ name: 'Hatch', bodyStyles: ['Hatchback'] }, { name: 'Countryman', bodyStyles: ['Crossover'] }, { name: 'Clubman', bodyStyles: ['Wagon'] }]},
]

export const VEHICLE_MAKES = VEHICLE_TAXONOMY.map(item => item.make)

export function makeTaxon(make: string | null | undefined) {
  const normalized = (make || '').trim().toLowerCase()
  if (!normalized) return null
  return VEHICLE_TAXONOMY.find(item =>
    item.make.toLowerCase() === normalized || (item.aliases || []).some(alias => alias.toLowerCase() === normalized),
  ) || null
}

export function modelsForMake(make: string | null | undefined) {
  return makeTaxon(make)?.models || []
}

export function canonicalMake(value: string) {
  return makeTaxon(value)?.make || value.trim()
}

export function canonicalModel(make: string, value: string) {
  const normalized = value.trim().toLowerCase()
  const match = modelsForMake(make).find(item =>
    item.name.toLowerCase() === normalized || (item.aliases || []).some(alias => alias.toLowerCase() === normalized),
  )
  return match?.name || value.trim()
}

export function taxonomySearchTerms(make: string, model?: string) {
  const makeEntry = makeTaxon(make)
  if (!makeEntry) return [make, model].filter(Boolean) as string[]
  const modelEntry = model
    ? makeEntry.models.find(item => item.name.toLowerCase() === model.toLowerCase() || (item.aliases || []).some(alias => alias.toLowerCase() === model.toLowerCase()))
    : null
  return [
    makeEntry.make,
    ...(makeEntry.aliases || []),
    ...(modelEntry ? [modelEntry.name, ...(modelEntry.aliases || [])] : []),
  ]
}
