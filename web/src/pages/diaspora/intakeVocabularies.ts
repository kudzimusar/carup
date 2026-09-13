/**
 * Intake 2.0 option vocabularies, mirrored from the server contract (§36).
 *
 * Separate from the controls file because these are data, not components — and because the option
 * ORDER is part of the product: the plain-language answers come first and "I'm not sure" is always
 * a real, listed choice rather than an afterthought.
 */
export const DESTINATION_OUTCOME_OPTIONS: Array<[string, string]> = [
  ['port_only', 'Collect it at the port myself'],
  ['port_plus_clearing', 'Port, and I need help clearing it'],
  ['cross_border_transit', 'Port, then across the border'],
  ['port_to_city', 'Bring it to my city'],
  ['door_delivery', 'Deliver it to my address'],
  ['unsure', "I'm not sure — recommend options"],
]
export const SHIPPING_OBJECTIVE_OPTIONS: Array<[string, string]> = [
  ['lowest_cost', 'Lowest reasonable cost'],
  ['faster_arrival', 'Faster arrival'],
  ['better_protection', 'Better protection / security'],
  ['extra_goods', 'I need to ship other goods with it'],
  ['non_running', 'The vehicle does not run'],
  ['multiple_vehicles', 'I have multiple vehicles'],
  ['private_container', 'I want a private container'],
  ['flexible', "I'm flexible — recommend suitable options"],
]
export const SHIPPING_MODE_OPTIONS: Array<[string, string]> = [
  ['no_preference', 'No preference'],
  ['roro', 'RoRo (driven on and off)'],
  ['shared_container', 'Shared container'],
  ['private_container', 'Private container'],
  ['provider_recommendation', 'Whatever the provider recommends'],
]
export const HANDLING_FLAG_OPTIONS: Array<[string, string]> = [
  ['fragile', 'Fragile'],
  ['stackable', 'Can be stacked'],
  ['oversized', 'Oversized'],
  ['keep_upright', 'Must stay upright'],
  ['special_handling', 'Needs special handling'],
]
export const CONTENT_DECLARATION_OPTIONS: Array<[string, string]> = [
  ['batteries', 'Batteries'],
  ['liquids', 'Liquids'],
  ['engines', 'Engines'],
  ['fuel_oil_residue', 'Fuel or oil residue'],
  ['tyres', 'Tyres'],
  ['chemicals', 'Chemicals'],
  ['hazardous_regulated', 'Hazardous or regulated goods'],
  ['none', 'None of these'],
  ['unknown', "I'm not sure"],
]
export const INSPECTION_INTENT_OPTIONS: Array<[string, string]> = [
  ['please_arrange', 'Please help arrange it'],
  ['already_arranged', 'Already arranged'],
  ['already_completed', 'Already completed'],
  ['unsure', 'Not sure if it is required'],
  ['not_applicable', 'Not applicable'],
]
export const INSURANCE_INTENT_OPTIONS: Array<[string, string]> = [
  ['interested', 'Interested — explain the options'],
  ['not_interested', 'Not interested'],
  ['already_insured', 'Already insured'],
  ['unsure', 'Not sure'],
]
export const CLEARING_INTENT_OPTIONS: Array<[string, string]> = [
  ['own_agent', 'I have my own clearing agent'],
  ['want_provider', 'Connect me with someone'],
  ['arrange_later', 'I will arrange it later'],
  ['unsure', 'Not sure'],
]
export const TIMING_FLEXIBILITY_OPTIONS: Array<[string, string]> = [
  ['fixed', 'Fixed — I have a hard deadline'],
  ['somewhat_flexible', 'Somewhat flexible'],
  ['flexible', 'Flexible'],
]

/**
 * Supplier-voice renderings of the SAME intake answers.
 *
 * The buyer's own option labels are written in the buyer's voice ("Deliver it to my address",
 * "I'm not sure — recommend options"). Printing those verbatim on a supplier's screen reads as
 * if the supplier said them. The fact is identical; only the speaker changes. Anything absent
 * here falls back to the generic humaniser, so a new vocabulary value degrades to readable
 * text rather than disappearing from the brief.
 */
const SUPPLIER_VOICE: Record<string, Record<string, string>> = {
  destination_outcome: {
    port_only: 'Buyer collects at the port',
    port_plus_clearing: 'Port, buyer wants clearing help',
    cross_border_transit: 'Port, then across the border',
    port_to_city: "Deliver to the buyer's city",
    door_delivery: "Deliver to the buyer's address",
    unsure: 'Buyer is unsure — open to your recommendation',
  },
  shipping_objective: {
    lowest_cost: 'Prioritises lowest reasonable cost',
    faster_arrival: 'Prioritises faster arrival',
    better_protection: 'Prioritises protection / security',
    extra_goods: 'Has other goods to ship with it',
    non_running: 'Vehicle does not run',
    multiple_vehicles: 'Has multiple vehicles',
    private_container: 'Wants a private container',
    flexible: 'Flexible — open to your recommendation',
  },
  shipping_mode_preference: {
    no_preference: 'No preference',
    roro: 'RoRo',
    shared_container: 'Shared container',
    private_container: 'Private container',
    provider_recommendation: 'Open to your recommendation',
  },
  alternatives_policy: {
    exact_only: 'Exact match only — do not propose alternatives',
    supplier_may_propose: 'You may propose alternatives',
    open_to_similar: 'Open to similar options',
  },
  timing_flexibility: {
    firm: 'Timing is firm',
    somewhat_flexible: 'Somewhat flexible on timing',
    very_flexible: 'Very flexible on timing',
  },
  intake_intent: {
    managed_import: 'Wants a managed end-to-end import',
    source_only: 'Wants sourcing only',
    compare_options: 'Comparing options',
    unsure: 'Unsure — open to your recommendation',
  },
  vehicle_steering: { rhd: 'Right-hand drive', lhd: 'Left-hand drive', either: 'Either' },
  vehicle_drivetrain: { '2wd': '2WD', '4wd_awd': '4WD / AWD', either: 'Either' },
  vehicle_transmission: { automatic: 'Automatic', manual: 'Manual', either: 'Either' },
  accident_repair_tolerance: {
    none: 'No accident repairs', minor_acceptable: 'Minor repairs acceptable',
    flexible: 'Flexible', unsure: 'Buyer is unsure',
  },
  rust_tolerance: {
    none: 'No rust', minor_acceptable: 'Minor rust acceptable',
    flexible: 'Flexible', unsure: 'Buyer is unsure',
  },
  intended_use: {
    personal_family: 'Personal / family', company: 'Company use',
    taxi_ride_hailing: 'Taxi / ride-hailing', dealer_resale: 'Dealer stock / resale',
    commercial_transport: 'Commercial transport', farm: 'Farm',
    mining_industrial: 'Mining / industrial', restoration_project: 'Restoration project',
    donor_parts: 'Parts / donor vehicle', other: 'Something else',
  },
  requested_quote_components: {
    item_price: 'item price', ocean_freight: 'ocean freight', inland_transport: 'inland transport',
    inspection: 'inspection', insurance: 'insurance', destination_clearing: 'destination clearing',
    duties_taxes: 'duties & taxes', delivery: 'delivery', storage: 'storage',
  },
}

/** snake_case → readable text, for any value the map above does not name. */
const humanise = (value: string) => value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export function supplierVoice(field: string, value: string): string {
  return SUPPLIER_VOICE[field]?.[value] ?? humanise(value)
}
