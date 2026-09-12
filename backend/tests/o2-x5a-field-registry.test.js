/**
 * O2-X5A — Workbook Field Registry pins.
 *
 * THE DRIFT LAW (plan B15): the spreadsheet must never silently fall behind the
 * site. Vocabularies are compared against their OWNING modules; web-owned lists
 * are source-pinned; and the create-route destructure is parsed so a NEW
 * accepted sell-flow key that the registry neither imports nor documents fails
 * THIS suite by name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  WORKBOOK_REGISTRY_VERSION,
  VEHICLE_TEMPLATE_KEYS,
  VEHICLE_TEMPLATE_SHEETS,
  VEHICLE_WORKBOOK_SHEETS,
  FORBIDDEN_WORKBOOK_COLUMNS,
  GOVERNED_RESULT_FIELDS,
  INTENTIONALLY_NON_IMPORTABLE,
  PHOTO_LABELS,
  ZIMBABWE_CITIES,
  ZIMBABWE_PROVINCES,
  buildVehicleWorkbookTemplate,
  listImportableFieldKeys,
  resolveFieldForHeader,
  resolveVocabularyValue,
  getSheetDefinition,
} from '../constants/workbook/workbookFieldRegistry.js';
import {
  ZIMBABWE_REGISTRATION_STATUSES,
  ZIMBABWE_REGISTRATION_PRESENTATION,
} from '../services/registration/zimbabweRegistrationLifecycle.js';
import {
  ACCIDENT_DISCLOSURE_STATES,
  INSURANCE_DISCLOSURE_STATES,
  FINANCE_DISCLOSURE_STATES,
  FINANCE_TYPES,
  PRIVATE_FINANCE_KEYS,
} from '../services/seller/vehicleHistoryDisclosures.js';
import { CLAIM_VISIBILITY } from '../utils/publicVehicleProjection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');

function vocabValues(sheetName, key) {
  const field = VEHICLE_WORKBOOK_SHEETS[sheetName].fields.find((f) => f.key === key);
  assert.ok(field, `${sheetName}.${key} exists`);
  return field.vocabulary.map((entry) => entry.value);
}

test('registry version and template composition match the documented catalogue', () => {
  assert.equal(WORKBOOK_REGISTRY_VERSION, 'carup_workbook_registry.v1');
  assert.deepEqual(VEHICLE_TEMPLATE_SHEETS[VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES],
    ['VEHICLES', 'LISTINGS', 'ACCIDENT_HISTORY', 'DISCLOSURES', 'MEDIA', 'EVIDENCE_NOTES']);
  assert.deepEqual(VEHICLE_TEMPLATE_SHEETS[VEHICLE_TEMPLATE_KEYS.DEALER_VEHICLE_INVENTORY],
    ['BUSINESS', 'BRANCHES', 'VEHICLES', 'LISTINGS', 'ACCIDENT_HISTORY', 'DISCLOSURES', 'MEDIA', 'EVIDENCE_NOTES']);
});

test('vocabularies are drawn from their OWNING modules — value-for-value', () => {
  assert.deepEqual(vocabValues('VEHICLES', 'registration_status'), [...ZIMBABWE_REGISTRATION_STATUSES]);
  // Human labels come from the SAME presentation map the site uses.
  const regField = VEHICLE_WORKBOOK_SHEETS.VEHICLES.fields.find((f) => f.key === 'registration_status');
  for (const entry of regField.vocabulary) {
    assert.equal(entry.label, ZIMBABWE_REGISTRATION_PRESENTATION[entry.value].label);
  }
  assert.deepEqual(vocabValues('ACCIDENT_HISTORY', 'accident_state'), [...ACCIDENT_DISCLOSURE_STATES]);
  assert.deepEqual(vocabValues('DISCLOSURES', 'insurance_state'), [...INSURANCE_DISCLOSURE_STATES]);
  assert.deepEqual(vocabValues('DISCLOSURES', 'finance_state'), [...FINANCE_DISCLOSURE_STATES]);
  assert.deepEqual(vocabValues('DISCLOSURES', 'finance_type'), [...FINANCE_TYPES]);
  assert.deepEqual(new Set(vocabValues('LISTINGS', 'location_visibility')),
    new Set(Object.values(CLAIM_VISIBILITY)));
});

test('taxonomy-owned vocabularies match the shared catalog dimensions', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'shared/taxonomy/vehicle/catalog.json'), 'utf8'));
  const labels = (dimension) => catalog.dimensions[dimension].map((entry) => entry.label);
  assert.deepEqual(vocabValues('VEHICLES', 'color'), labels('colors'));
  assert.deepEqual(vocabValues('VEHICLES', 'body_style'), labels('bodyStyles'));
  assert.deepEqual(vocabValues('VEHICLES', 'fuel_type'), labels('fuelTypes'));
  assert.deepEqual(vocabValues('VEHICLES', 'transmission'), labels('transmissions'));
  assert.deepEqual(vocabValues('VEHICLES', 'drivetrain'), labels('drivetrains'));
  assert.deepEqual(vocabValues('VEHICLES', 'seller_stated_condition'), labels('sellerConditions'));
});

test('web-owned lists are source-pinned: photo labels, cities, provinces', () => {
  const sellSource = fs.readFileSync(path.join(repoRoot, 'web/src/pages/dashboard/owner/SellVehicle.tsx'), 'utf8');
  for (const label of PHOTO_LABELS) {
    assert.ok(sellSource.includes(`'${label}'`), `photo label '${label}' still exists in SellVehicle.tsx`);
  }
  const mockData = fs.readFileSync(path.join(repoRoot, 'web/src/data/mockData.ts'), 'utf8');
  for (const city of ZIMBABWE_CITIES) {
    assert.ok(mockData.includes(`'${city}'`) || mockData.includes(`"${city}"`), `city '${city}' still exists in mockData.ts`);
  }
  for (const province of ZIMBABWE_PROVINCES) {
    assert.ok(mockData.includes(`'${province}'`) || mockData.includes(`"${province}"`), `province '${province}' still in mockData.ts`);
  }
});

test('THE TRIPWIRE — every key the create route accepts is importable, documented non-importable, or disclosure-composed', () => {
  const serverSource = fs.readFileSync(path.join(repoRoot, 'backend/server.js'), 'utf8');
  // Anchor the exact destructure of POST /api/vehicles/add (contains chassis_number + client_submission_id).
  const match = serverSource.match(/const \{([\s\S]{0,1500}?)\}\s*=\s*req\.body/g)
    ?.find((block) => block.includes('chassis_number') && block.includes('client_submission_id'));
  assert.ok(match, 'the create-route req.body destructure was found');
  const keys = [...match.matchAll(/(?:^|[,{\n])\s*([a-z_]+)\s*(?=[,\n}])/g)]
    .map((m) => m[1])
    .filter((k) => !['const'].includes(k));
  assert.ok(keys.includes('vin') && keys.includes('accident_disclosure'), 'destructure parsed');

  const importable = new Set(listImportableFieldKeys(VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES));
  const documented = new Set(Object.keys(INTENTIONALLY_NON_IMPORTABLE));
  const unaccounted = keys.filter((key) => !importable.has(key) && !documented.has(key));
  assert.deepEqual(unaccounted, [],
    `NEW sell-flow key(s) the workbook registry neither imports nor documents: ${unaccounted.join(', ')} — `
    + 'cover them in workbookFieldRegistry.js (and the catalogue manual) before merging.');
});

test('forbidden columns: all 11 private-banking keys and every governed_result field, refused as targets', () => {
  for (const key of PRIVATE_FINANCE_KEYS) {
    assert.ok(FORBIDDEN_WORKBOOK_COLUMNS.includes(key), `${key} is forbidden`);
  }
  for (const key of ['trust_score', 'verification_status', 'publication_status', 'owner_id', 'current_seller_id', 'tenant_id', 'duty_paid', 'police_verified', 'can_publish']) {
    assert.ok(GOVERNED_RESULT_FIELDS.includes(key), `${key} is a governed result`);
  }
  // And none of them is a registry column anywhere.
  for (const sheet of Object.values(VEHICLE_WORKBOOK_SHEETS)) {
    for (const field of sheet.fields) {
      assert.ok(!FORBIDDEN_WORKBOOK_COLUMNS.includes(field.key),
        `${sheet.name}.${field.key} must never be a workbook column`);
    }
  }
});

test('label↔canonical round-trip: headers resolve both ways; values resolve by canonical, label and alias', () => {
  const byHeader = resolveFieldForHeader('VEHICLES', 'Registration stage');
  const byKey = resolveFieldForHeader('VEHICLES', 'registration_status');
  assert.equal(byHeader?.key, 'registration_status');
  assert.equal(byKey?.key, 'registration_status');

  const transmission = getSheetDefinition('VEHICLES').fields.find((f) => f.key === 'transmission');
  assert.deepEqual(resolveVocabularyValue(transmission, 'Automatic'), { value: 'Automatic', method: 'canonical' });
  assert.deepEqual(resolveVocabularyValue(transmission, 'auto'), { value: 'Automatic', method: 'alias' });
  const registration = getSheetDefinition('VEHICLES').fields.find((f) => f.key === 'registration_status');
  assert.deepEqual(
    resolveVocabularyValue(registration, 'Customs cleared — local registration pending'),
    { value: 'customs_cleared_cvr_pending', method: 'label' },
  );
  assert.equal(resolveVocabularyValue(transmission, 'warp drive').method, null);
});

test('engine template objects carry version, instructions, dropdowns and human-label headers', () => {
  const template = buildVehicleWorkbookTemplate(VEHICLE_TEMPLATE_KEYS.SELLER_VEHICLES);
  assert.equal(template.schemaVersion, '2026.09.x5a.vehicle-v1');
  assert.ok(template.importInstructions.length >= 8);
  assert.ok(template.privacyWarning.includes('never asks for bank balances'));
  const vehicles = template.sheets.find((sheet) => sheet.name === 'VEHICLES');
  assert.equal(vehicles.columns[0].header, 'VIN / Vehicle Identifier');
  const regColumn = vehicles.columns.find((column) => column.key === 'registration_status');
  assert.ok(regColumn.validationList.includes('Customs cleared — local registration pending'));
  // Reference lists ride ON the template object (engine generalization contract).
  assert.ok(template.referenceSheets[0].statusLists['VEHICLES.registration_status']);
});
