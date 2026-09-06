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
