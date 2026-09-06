/**
 * Trade OS — turning intake answers into persisted facts (Intake Contract §36).
 *
 * One module so the procurement and logistics spines cannot drift into two different readings of
 * the same question, and so every new field has exactly one place where its validation, its
 * default-freedom and its privacy class are decided.
 *
 * The rule that shapes all of it: an unanswered question yields `null`, and `null` is written. It
 * is never coerced to a zero, an empty string, or a plausible-looking default, because a request
 * that says "0 kg" when the customer meant "I don't know" is worse than one that admits it.
 */
import {
  INTAKE_INTENTS, BUDGET_BASES, BUDGET_FLEXIBILITY, DESTINATION_OUTCOMES, CONSIGNEE_KINDS,
  SHIPPING_OBJECTIVES, SHIPPING_MODE_PREFERENCES, INSPECTION_INTENTS, INSURANCE_INTENTS,
  CLEARING_INTENTS, PAYMENT_INTENTS, TIMING_FLEXIBILITY, ALTERNATIVES_POLICIES, QUOTE_COMPONENTS,
  TRANSMISSIONS, DRIVETRAINS, STEERING, TOLERANCES, INTENDED_USES, PART_ORIGINS,
  PICKUP_REQUIRED, ORIGIN_SITE_TYPES, GOODS_NATURES, HANDLING_FLAGS, CONTENT_DECLARATIONS,
  VEHICLE_RUNNING_STATES, VEHICLE_KEYS_STATES, EXPORT_CLEARANCE_STATES,
  optionalChoice, optionalChoiceList, optionalPositiveNumber, optionalDate,
} from './tradeIntakeContract.js';
import { ValidationError } from '../../utils/errors.js';

const pick = (payload, ...names) => {
  for (const name of names) {
    if (payload[name] !== undefined) return payload[name];
  }
  return undefined;
};
const text = (value, max = 200) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
};
const guard = (fn) => { try { return fn(); } catch (error) { throw new ValidationError(error.message); } };

/**
 * Procurement header intake — the outcome and the commercial meaning.
 *
 * `budget_disclosed` is the only field here that changes who sees what, so it is explicitly boolean
 * and defaults to FALSE. A budget is a negotiating position: silence must stay silence rather than
 * becoming disclosure because a checkbox was absent from a payload.
 */
export function normalizeOrderIntake(payload = {}, previous = {}) {
  const keep = (field, value) => (value === null && payload[field] === undefined ? previous[field] ?? null : value);
  return guard(() => ({
    intake_intent: keep('intake_intent', optionalChoice(pick(payload, 'intake_intent', 'intakeIntent'), INTAKE_INTENTS, 'Request type')),
    budget_basis: keep('budget_basis', optionalChoice(pick(payload, 'budget_basis', 'budgetBasis'), BUDGET_BASES, 'Budget basis')),
    budget_max_amount: keep('budget_max_amount', optionalPositiveNumber(pick(payload, 'budget_max_amount', 'budgetMaxAmount'), 'Maximum budget')),
    budget_flexibility: keep('budget_flexibility', optionalChoice(pick(payload, 'budget_flexibility', 'budgetFlexibility'), BUDGET_FLEXIBILITY, 'Budget flexibility')),
    budget_disclosed: pick(payload, 'budget_disclosed', 'budgetDisclosed') === undefined
      ? Boolean(previous.budget_disclosed)
      : pick(payload, 'budget_disclosed', 'budgetDisclosed') === true,
    destination_outcome: keep('destination_outcome', optionalChoice(pick(payload, 'destination_outcome', 'destinationOutcome'), DESTINATION_OUTCOMES, 'Destination outcome')),
    destination_area: keep('destination_area', text(pick(payload, 'destination_area', 'destinationArea'), 300)),
    preferred_port: keep('preferred_port', text(pick(payload, 'preferred_port', 'preferredPort'), 150)),
    consignee_kind: keep('consignee_kind', optionalChoice(pick(payload, 'consignee_kind', 'consigneeKind'), CONSIGNEE_KINDS, 'Consignee')),
    shipping_objective: keep('shipping_objective', optionalChoice(pick(payload, 'shipping_objective', 'shippingObjective'), SHIPPING_OBJECTIVES, 'Shipping objective')),
    shipping_mode_preference: keep('shipping_mode_preference', optionalChoice(pick(payload, 'shipping_mode_preference', 'shippingModePreference'), SHIPPING_MODE_PREFERENCES, 'Shipping mode')),
    inspection_intent: keep('inspection_intent', optionalChoice(pick(payload, 'inspection_intent', 'inspectionIntent'), INSPECTION_INTENTS, 'Inspection')),
    insurance_intent: keep('insurance_intent', optionalChoice(pick(payload, 'insurance_intent', 'insuranceIntent'), INSURANCE_INTENTS, 'Insurance')),
    clearing_intent: keep('clearing_intent', optionalChoice(pick(payload, 'clearing_intent', 'clearingIntent'), CLEARING_INTENTS, 'Clearing')),
    payment_intent: keep('payment_intent', optionalChoice(pick(payload, 'payment_intent', 'paymentIntent'), PAYMENT_INTENTS, 'Payment')),
    available_from: keep('available_from', optionalDate(pick(payload, 'available_from', 'availableFrom'), 'Available from')),
    arrival_window_start: keep('arrival_window_start', optionalDate(pick(payload, 'arrival_window_start', 'arrivalWindowStart'), 'Arrival window start')),
    arrival_window_end: keep('arrival_window_end', optionalDate(pick(payload, 'arrival_window_end', 'arrivalWindowEnd'), 'Arrival window end')),
    deadline_is_hard: pick(payload, 'deadline_is_hard', 'deadlineIsHard') === undefined
      ? previous.deadline_is_hard ?? null
      : Boolean(pick(payload, 'deadline_is_hard', 'deadlineIsHard')),
    timing_flexibility: keep('timing_flexibility', optionalChoice(pick(payload, 'timing_flexibility', 'timingFlexibility'), TIMING_FLEXIBILITY, 'Timing flexibility')),
    requested_quote_components: keep('requested_quote_components', optionalChoiceList(pick(payload, 'requested_quote_components', 'requestedQuoteComponents'), QUOTE_COMPONENTS, 'Requested quote components')),
    alternatives_policy: keep('alternatives_policy', optionalChoice(pick(payload, 'alternatives_policy', 'alternativesPolicy'), ALTERNATIVES_POLICIES, 'Alternatives')),
  }));
}

/**
 * Procurement line intake — what a supplier matches inventory against.
 *
 * Every one of these is a PREFERENCE, and every one may be absent. A customer who does not know
 * what a drivetrain is must still be able to ask for a car.
 */
export function normalizeLineIntake(payload = {}) {
  return guard(() => ({
    vehicle_body_type: text(pick(payload, 'vehicle_body_type', 'bodyType'), 60),
    vehicle_fuel_type: text(pick(payload, 'vehicle_fuel_type', 'fuelType'), 60),
    vehicle_transmission: optionalChoice(pick(payload, 'vehicle_transmission', 'transmission'), TRANSMISSIONS, 'Transmission'),
    vehicle_drivetrain: optionalChoice(pick(payload, 'vehicle_drivetrain', 'drivetrain'), DRIVETRAINS, 'Drivetrain'),
    vehicle_steering: optionalChoice(pick(payload, 'vehicle_steering', 'steering'), STEERING, 'Steering'),
    vehicle_seats_min: optionalPositiveNumber(pick(payload, 'vehicle_seats_min', 'seatsMin'), 'Seats'),
    vehicle_mileage_max_km: optionalPositiveNumber(pick(payload, 'vehicle_mileage_max_km', 'mileageMaxKm'), 'Maximum mileage'),
    vehicle_colour_preference: text(pick(payload, 'vehicle_colour_preference', 'colourPreference'), 60),
    vehicle_trim_preference: text(pick(payload, 'vehicle_trim_preference', 'trimPreference'), 80),
    vehicle_generation_code: text(pick(payload, 'vehicle_generation_code', 'generationCode'), 60),
    vehicle_engine_cc_min: optionalPositiveNumber(pick(payload, 'vehicle_engine_cc_min', 'engineCcMin'), 'Engine capacity'),
    vehicle_engine_cc_max: optionalPositiveNumber(pick(payload, 'vehicle_engine_cc_max', 'engineCcMax'), 'Engine capacity'),
    vehicle_auction_grade: text(pick(payload, 'vehicle_auction_grade', 'auctionGrade'), 20),
    accident_repair_tolerance: optionalChoice(pick(payload, 'accident_repair_tolerance', 'accidentRepairTolerance'), TOLERANCES, 'Accident-repair tolerance'),
    rust_tolerance: optionalChoice(pick(payload, 'rust_tolerance', 'rustTolerance'), TOLERANCES, 'Rust tolerance'),
    intended_use: optionalChoice(pick(payload, 'intended_use', 'intendedUse'), INTENDED_USES, 'Intended use'),
    alternative_models: (() => {
      const raw = pick(payload, 'alternative_models', 'alternativeModels');
      if (raw === undefined || raw === null) return null;
      const list = (Array.isArray(raw) ? raw : String(raw).split(','))
        .map((v) => text(v, 80)).filter(Boolean);
      return list.length ? [...new Set(list)] : null;
    })(),
    part_side: text(pick(payload, 'part_side', 'partSide'), 40),
    part_origin_preference: optionalChoice(pick(payload, 'part_origin_preference', 'partOriginPreference'), PART_ORIGINS, 'OEM/aftermarket'),
    brand_preference: text(pick(payload, 'brand_preference', 'brandPreference'), 80),
  }));
}

/** Logistics header intake — handling intent and timing. */
export function normalizeLogisticsIntake(payload = {}, previous = {}) {
  const keep = (field, value) => (value === null && payload[field] === undefined ? previous[field] ?? null : value);
  return guard(() => ({
    pickup_required: keep('pickup_required', optionalChoice(pick(payload, 'pickup_required', 'pickupRequired'), PICKUP_REQUIRED, 'Pickup')),
    origin_site_type: keep('origin_site_type', optionalChoice(pick(payload, 'origin_site_type', 'originSiteType'), ORIGIN_SITE_TYPES, 'Origin site type')),
    destination_outcome: keep('destination_outcome', optionalChoice(pick(payload, 'destination_outcome', 'destinationOutcome'), DESTINATION_OUTCOMES, 'Destination outcome')),
    shipping_objective: keep('shipping_objective', optionalChoice(pick(payload, 'shipping_objective', 'shippingObjective'), SHIPPING_OBJECTIVES, 'Shipping objective')),
    available_from: keep('available_from', optionalDate(pick(payload, 'available_from', 'availableFrom'), 'Available from')),
    arrival_window_start: keep('arrival_window_start', optionalDate(pick(payload, 'arrival_window_start', 'arrivalWindowStart'), 'Arrival window start')),
    arrival_window_end: keep('arrival_window_end', optionalDate(pick(payload, 'arrival_window_end', 'arrivalWindowEnd'), 'Arrival window end')),
    timing_flexibility: keep('timing_flexibility', optionalChoice(pick(payload, 'timing_flexibility', 'timingFlexibility'), TIMING_FLEXIBILITY, 'Timing flexibility')),
  }));
}

/**
 * Cargo intake — handling characteristics and content disclosures.
 *
 * `content_declarations` is a DISCLOSURE. It tells a provider what is in the box so they can decide
 * whether they can carry it; it is never CarUp certifying that they can.
 */
export function normalizeCargoIntake(payload = {}) {
  return guard(() => ({
    packaging_type: text(pick(payload, 'packaging_type', 'packagingType'), 80),
    goods_nature: optionalChoice(pick(payload, 'goods_nature', 'goodsNature'), GOODS_NATURES, 'Nature of goods'),
    declared_value: optionalPositiveNumber(pick(payload, 'declared_value', 'declaredValue'), 'Declared value'),
    declared_value_currency: text(pick(payload, 'declared_value_currency', 'declaredValueCurrency'), 3),
    handling_flags: optionalChoiceList(pick(payload, 'handling_flags', 'handlingFlags'), HANDLING_FLAGS, 'Handling'),
    content_declarations: optionalChoiceList(pick(payload, 'content_declarations', 'contentDeclarations'), CONTENT_DECLARATIONS, 'Contents'),
    vehicle_running_state: optionalChoice(pick(payload, 'vehicle_running_state', 'vehicleRunningState'), VEHICLE_RUNNING_STATES, 'Running condition'),
    vehicle_keys_state: optionalChoice(pick(payload, 'vehicle_keys_state', 'vehicleKeysState'), VEHICLE_KEYS_STATES, 'Keys'),
    export_clearance_state: optionalChoice(pick(payload, 'export_clearance_state', 'exportClearanceState'), EXPORT_CLEARANCE_STATES, 'Export status'),
  }));
}
