/**
 * O2-X5A — server-sourced vehicle workbook export.
 *
 * THE EXPORT LAW (B9): the DATABASE is the source; rows are scoped to what the
 * caller may export (their OWN vehicles — vehicles.current_seller_id; their OWN
 * dealer application) and privacy-redacted by the field registry
 * (exportRedacted fields ship as [REDACTED] by default). Caller-supplied rows
 * are never a trusted export; there is no code path here that accepts them.
 */
import { supabase } from '../../db/supabase.js';
import { ValidationError } from '../../utils/errors.js';
import { exportWorkbook } from '../diaspora/workbook/diasporaWorkbookXlsxService.js';
import {
  VEHICLE_TEMPLATE_KEYS,
  VEHICLE_WORKBOOK_SHEETS,
  buildVehicleWorkbookTemplate,
  isVehicleWorkbookTemplateKey,
} from '../../constants/workbook/workbookFieldRegistry.js';

export const MAX_EXPORT_VEHICLES = 2000;

function labelFor(sheetName, key, value) {
  const field = VEHICLE_WORKBOOK_SHEETS[sheetName].fields.find((candidate) => candidate.key === key);
  if (!field?.vocabulary) return value;
  const entry = field.vocabulary.find((candidate) => candidate.value === value);
  return entry ? entry.label : value;
}

function headerRow(sheetName, values) {
  // exportWorkbook keys cells by column HEADER; translate registry keys → headers.
  const bySheet = VEHICLE_WORKBOOK_SHEETS[sheetName];
  const out = {};
  for (const field of bySheet.fields) {
    if (values[field.key] === undefined || values[field.key] === null || values[field.key] === '') continue;
    out[field.header] = labelFor(sheetName, field.key, values[field.key]);
  }
  return out;
}

function defaultRedactHeaders(templateKey) {
  const headers = [];
  const sheets = templateKey === VEHICLE_TEMPLATE_KEYS.DEALER_VEHICLE_INVENTORY
    ? Object.keys(VEHICLE_WORKBOOK_SHEETS)
    : Object.keys(VEHICLE_WORKBOOK_SHEETS).filter((name) => !VEHICLE_WORKBOOK_SHEETS[name].dealerOnly);
  for (const sheetName of sheets) {
    for (const field of VEHICLE_WORKBOOK_SHEETS[sheetName].fields) {
      if (field.exportRedacted) headers.push(field.header);
    }
  }
  return [...new Set(headers)];
}

export async function exportVehicleWorkbookFromDatabase(templateKey, actor = {}, options = {}) {
  if (!isVehicleWorkbookTemplateKey(templateKey)) {
    throw new ValidationError(`'${templateKey}' is not a vehicle workbook template.`);
  }
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  const client = options.supabaseClient || supabase;

  // OWN vehicles only — listing authority scope, the same fact the site uses.
  const { data: vehicles, error } = await client
    .from('vehicles')
    .select('*')
    .eq('current_seller_id', userId)
    .limit(MAX_EXPORT_VEHICLES);
  if (error) throw new Error(error.message);

  const vins = (vehicles || []).map((vehicle) => vehicle.vin).filter(Boolean);
  let imagesByVin = new Map();
  if (vins.length) {
    const { data: images, error: imagesError } = await client
      .from('listing_images')
      .select('vin, image_url, photo_label, is_primary, display_order')
      .in('vin', vins);
    if (!imagesError) {
      imagesByVin = (images || []).reduce((acc, image) => {
        if (!acc.has(image.vin)) acc.set(image.vin, []);
        acc.get(image.vin).push(image);
        return acc;
      }, new Map());
    }
  }

  const rowsBySheet = { VEHICLES: [], LISTINGS: [], ACCIDENT_HISTORY: [], DISCLOSURES: [], MEDIA: [], EVIDENCE_NOTES: [] };
  for (const vehicle of vehicles || []) {
    rowsBySheet.VEHICLES.push(headerRow('VEHICLES', {
      vin: vehicle.vin, make: vehicle.make, model: vehicle.model, year: vehicle.year,
      color: vehicle.color, mileage: vehicle.mileage, body_style: vehicle.body_style,
      seller_stated_condition: vehicle.seller_stated_condition, fuel_type: vehicle.fuel_type,
      transmission: vehicle.transmission, drivetrain: vehicle.drivetrain,
      engine_number: vehicle.engine_number, chassis_number: vehicle.chassis_number,
      generation: vehicle.generation, trim: vehicle.trim,
      registration_status: vehicle.registration_status, plate_number: vehicle.plate_number,
      temp_plate_id: vehicle.temp_plate_id, registration_country: vehicle.registration_country,
    }));
    rowsBySheet.LISTINGS.push(headerRow('LISTINGS', {
      vin: vehicle.vin, price: vehicle.price, currency: vehicle.currency,
      listing_city: vehicle.listing_city, listing_province: vehicle.listing_province,
      listing_country: vehicle.listing_country, seller_description: vehicle.seller_description,
      seller_features: Array.isArray(vehicle.seller_features) ? vehicle.seller_features.join(', ') : vehicle.seller_features,
      location_visibility: vehicle.listing_location_visibility,
      public_seller_display_enabled: vehicle.public_seller_display_enabled === true ? true : (vehicle.public_seller_display_enabled === false ? false : undefined),
    }));
    const accident = vehicle.seller_accident_disclosure;
    if (accident?.state) {
      const events = Array.isArray(accident.events) && accident.events.length ? accident.events : [null];
      for (const event of events) {
        rowsBySheet.ACCIDENT_HISTORY.push(headerRow('ACCIDENT_HISTORY', {
          vin: vehicle.vin, accident_state: accident.state,
          approx_date: event?.approx_date, event_mileage: event?.mileage,
          damage_area: event?.damage_area, severity: event?.severity,
          insurer_involved: event?.insurer_involved, police_report_state: event?.police_report_state,
          repair_state: event?.repair_state, repairer: event?.repairer,
        }));
      }
    }
    const insurance = vehicle.seller_insurance_disclosure;
    const finance = vehicle.seller_finance_disclosure;
    if (insurance?.state || finance?.state) {
      rowsBySheet.DISCLOSURES.push(headerRow('DISCLOSURES', {
        vin: vehicle.vin,
        insurance_state: insurance?.state, insurer_name: insurance?.insurer_name,
        finance_state: finance?.state, finance_type: finance?.finance_type, lender_name: finance?.lender_name,
      }));
    }
    for (const image of imagesByVin.get(vehicle.vin) || []) {
      rowsBySheet.MEDIA.push(headerRow('MEDIA', {
        vin: vehicle.vin, image_url: image.image_url, photo_label: image.photo_label,
        is_primary: image.is_primary === true ? true : undefined, display_order: image.display_order,
      }));
    }
    // EVIDENCE_NOTES deliberately exports EMPTY: evidence files are private and their
    // review state is a governed fact — the export never carries evidence links.
  }

  const template = buildVehicleWorkbookTemplate(templateKey);
  if (templateKey === VEHICLE_TEMPLATE_KEYS.DEALER_VEHICLE_INVENTORY) {
    rowsBySheet.BUSINESS = [];
    rowsBySheet.BRANCHES = [];
    const { data: profiles } = await client.from('dealer_profiles').select('*').eq('user_id', userId);
    const profile = (profiles || [])[0];
    if (profile) {
      rowsBySheet.BUSINESS.push(headerRow('BUSINESS', {
        legal_name: profile.legal_name, trading_name: profile.trading_name,
        registration_number: profile.registration_number, tax_id: profile.tax_id,
        physical_address: profile.physical_address, responsible_person: profile.responsible_person,
        operating_country: profile.operating_country,
      }));
      const { data: branches } = await client.from('dealer_branches').select('*').eq('dealer_id', profile.id);
      for (const branch of branches || []) {
        rowsBySheet.BRANCHES.push(headerRow('BRANCHES', { branch_name: branch.name, branch_address: branch.address }));
      }
    }
  }

  const redactFields = options.includeSensitive === true ? [] : defaultRedactHeaders(templateKey);
  const buffer = await exportWorkbook(template, rowsBySheet, {
    redactFields,
    context: options.context || {},
  });
  return {
    buffer,
    filename: `carup-${templateKey}-export.xlsx`,
    vehicleCount: (vehicles || []).length,
    redactedHeaders: redactFields,
  };
}
