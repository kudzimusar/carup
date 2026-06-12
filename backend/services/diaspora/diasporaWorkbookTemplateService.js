import {
  WORKBOOK_SHEETS,
  WORKBOOK_STATUS_LISTS,
  WORKBOOK_TEMPLATE_TYPES,
  getRequiredSheetsForTemplate,
  normalizeWorkbookTemplateType,
} from '../../constants/diaspora/diasporaWorkbookSchema.js';

function cloneSheetDefinition([sheetName, definition]) {
  return {
    sheetName,
    description: definition.description,
    primaryKey: definition.primaryKey,
    apiTable: definition.apiTable,
    requiredColumns: [...definition.requiredColumns],
    optionalColumns: [...definition.optionalColumns],
    statusColumns: { ...definition.statusColumns },
  };
}

export function getDiasporaWorkbookTemplateSchema(templateType = WORKBOOK_TEMPLATE_TYPES.ENTERPRISE) {
  const normalizedTemplateType = normalizeWorkbookTemplateType(templateType);
  const requiredSheetNames = new Set(getRequiredSheetsForTemplate(normalizedTemplateType));

  const sheets = Object.entries(WORKBOOK_SHEETS)
    .filter(([sheetName]) => requiredSheetNames.has(sheetName))
    .map(cloneSheetDefinition);

  return {
    version: '2026.06.phase1a',
    templateType: normalizedTemplateType,
    sourceOfTruth: 'CarUp database. Workbook rows are offline staging records until dry-run validation and import confirmation pass.',
    safetyRules: [
      'Dry-run validation must never write to Supabase.',
      'Workbook IMPORT_* IDs are offline identifiers; CARUP_*_UUID fields store database IDs after import.',
      'AI_COMMAND_CENTER creates draft actions only; AI must not bypass authorization, entitlement, approval, or audit controls.',
      'Stock quantities must eventually be changed through ledger actions, not direct total overwrites.',
    ],
    statusLists: Object.fromEntries(Object.entries(WORKBOOK_STATUS_LISTS).map(([key, value]) => [key, [...value]])),
    sheets,
  };
}

export function listSupportedWorkbookTemplates() {
  return Object.values(WORKBOOK_TEMPLATE_TYPES).map((templateType) => ({
    templateType,
    sheets: [...getRequiredSheetsForTemplate(templateType)],
  }));
}
