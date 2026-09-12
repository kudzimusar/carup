import { ValidationError } from '../../utils/errors.js';
import { WORKBOOK_SHEETS } from '../../constants/diaspora/diasporaWorkbookSchema.js';
import { XLSX_SCHEMA_VERSION } from '../../constants/diaspora/diasporaWorkbookTemplates.js';
import {
  TRADE_SCENARIO_ASSERTION_TYPES,
  TRADE_SCENARIO_ENVIRONMENTS,
} from '../../constants/diaspora/diasporaTradeScenarioConstants.js';
import { TRADE_REFERENCE_PACKS, TRADE_SCENARIOS } from '../../fixtures/trade-os/tradeScenarioCatalog.js';
import { exportWorkbook, parseWorkbook } from './workbook/diasporaWorkbookXlsxService.js';
import { validateDiasporaWorkbookDryRun } from './diasporaWorkbookValidationService.js';
import { buildWorkbookRowDiagnostics } from './diasporaWorkbookPersistenceService.js';
import { buildWorkbookImportPlan } from './diasporaWorkbookImportPlanningService.js';

const DEFAULT_SCENARIO_TIMESTAMP = '2026-09-13T00:00:00.000Z';

function normalizeEnvironment(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['production', 'prod'].includes(normalized)) return TRADE_SCENARIO_ENVIRONMENTS.PRODUCTION;
  if (['preview', 'staging', 'uat'].includes(normalized)) return TRADE_SCENARIO_ENVIRONMENTS.STAGING;
  if (normalized === 'test') return TRADE_SCENARIO_ENVIRONMENTS.TEST;
  if (normalized === 'demo') return TRADE_SCENARIO_ENVIRONMENTS.DEMO;
  return TRADE_SCENARIO_ENVIRONMENTS.LOCAL;
}

export function resolveTradeScenarioEnvironment(options = {}) {
  if (options.environmentClass) return normalizeEnvironment(options.environmentClass);
  return normalizeEnvironment(
    process.env.CARUP_ENVIRONMENT
      || process.env.VERCEL_ENV
      || process.env.NODE_ENV
      || TRADE_SCENARIO_ENVIRONMENTS.LOCAL,
  );
}

function getScenarioOrThrow(scenarioId) {
  const scenario = TRADE_SCENARIOS[String(scenarioId || '').trim()];
  if (!scenario) {
    throw new ValidationError('Unknown Trade OS scenario.', {
      code: 'TRADE_SCENARIO_NOT_FOUND',
      scenarioId,
      supportedScenarioIds: Object.keys(TRADE_SCENARIOS),
    });
  }
  return scenario;
}

function getReferencePackOrThrow(referencePackId) {
  const pack = TRADE_REFERENCE_PACKS[referencePackId];
  if (!pack) {
    throw new ValidationError('Trade OS scenario references an unknown reference pack.', {
      code: 'TRADE_SCENARIO_REFERENCE_PACK_NOT_FOUND',
      referencePackId,
    });
  }
  return pack;
}

export function validateTradeScenarioManifest(manifest = {}) {
  const errors = [];
  const required = ['scenarioId', 'title', 'scenarioVersion', 'workbookSchemaVersion', 'allowedEnvironments', 'productionForbidden'];
  for (const field of required) {
    if (manifest[field] === null || manifest[field] === undefined || manifest[field] === '') {
      errors.push({ code: 'MANIFEST_REQUIRED_FIELD_MISSING', field });
    }
  }
  if (!Array.isArray(manifest.allowedEnvironments) || manifest.allowedEnvironments.length === 0) {
    errors.push({ code: 'MANIFEST_ALLOWED_ENVIRONMENTS_REQUIRED', field: 'allowedEnvironments' });
  }
  if (manifest.workbookSchemaVersion && manifest.workbookSchemaVersion !== XLSX_SCHEMA_VERSION) {
    errors.push({
      code: 'MANIFEST_WORKBOOK_SCHEMA_VERSION_MISMATCH',
      expected: XLSX_SCHEMA_VERSION,
      actual: manifest.workbookSchemaVersion,
    });
  }
  return { valid: errors.length === 0, errors };
}

export function assertTradeScenarioAllowed(manifest = {}, options = {}) {
  const manifestValidation = validateTradeScenarioManifest(manifest);
  if (!manifestValidation.valid) {
    throw new ValidationError('Trade OS scenario manifest is invalid.', {
      code: 'TRADE_SCENARIO_MANIFEST_INVALID',
      errors: manifestValidation.errors,
    });
  }

  const environmentClass = resolveTradeScenarioEnvironment(options);
  if (environmentClass === TRADE_SCENARIO_ENVIRONMENTS.PRODUCTION && manifest.productionForbidden !== false) {
    throw new ValidationError('Trade OS test scenarios are forbidden in production.', {
      code: 'TRADE_SCENARIO_PRODUCTION_FORBIDDEN',
      scenarioId: manifest.scenarioId,
      environmentClass,
    });
  }
  if (!manifest.allowedEnvironments.includes(environmentClass)) {
    throw new ValidationError('Trade OS scenario is not allowed in this environment.', {
      code: 'TRADE_SCENARIO_ENVIRONMENT_NOT_ALLOWED',
      scenarioId: manifest.scenarioId,
      environmentClass,
      allowedEnvironments: manifest.allowedEnvironments,
    });
  }
  return environmentClass;
}

function referencePackSummary(pack) {
  return {
    referencePackId: pack.referencePackId,
    version: pack.version,
    fixtureClass: pack.fixtureClass,
    sourceType: pack.sourceType,
    description: pack.description,
    sheetCounts: Object.fromEntries(
      Object.entries(pack.sheets || {}).map(([sheetName, rows]) => [sheetName, Array.isArray(rows) ? rows.length : 0]),
    ),
    entityCounts: Object.fromEntries(
      Object.entries(pack.entities || {}).map(([entityName, rows]) => [entityName, Array.isArray(rows) ? rows.length : 0]),
    ),
  };
}

function inputSummary(input) {
  return {
    inputId: input.inputId,
    templateType: input.templateType,
    sourceType: input.sourceType,
    sourceSheetCounts: Object.fromEntries(
      Object.entries(input.sheets || {}).map(([sheetName, rows]) => [sheetName, Array.isArray(rows) ? rows.length : 0]),
    ),
  };
}

export function listDiasporaTradeScenarios() {
  return Object.values(TRADE_SCENARIOS).map((scenario) => ({
    ...scenario.manifest,
    assertions: undefined,
    postImportAssertions: undefined,
    inputCount: scenario.workbooks.length,
    inputs: scenario.workbooks.map(inputSummary),
  }));
}

export function getDiasporaTradeScenario(scenarioId) {
  const scenario = getScenarioOrThrow(scenarioId);
  return {
    manifest: scenario.manifest,
    inputs: scenario.workbooks.map(inputSummary),
    referencePacks: scenario.manifest.referencePackDependencies.map((id) => referencePackSummary(getReferencePackOrThrow(id))),
  };
}

function findInputOrThrow(scenario, inputId) {
  const input = scenario.workbooks.find((candidate) => candidate.inputId === inputId);
  if (!input) {
    throw new ValidationError('Unknown Trade OS scenario workbook input.', {
      code: 'TRADE_SCENARIO_INPUT_NOT_FOUND',
      scenarioId: scenario.manifest.scenarioId,
      inputId,
      supportedInputIds: scenario.workbooks.map((candidate) => candidate.inputId),
    });
  }
  return input;
}

export async function generateDiasporaTradeScenarioWorkbook(scenarioId, inputId, options = {}) {
  const scenario = getScenarioOrThrow(scenarioId);
  const environmentClass = assertTradeScenarioAllowed(scenario.manifest, options);
  const input = findInputOrThrow(scenario, inputId);
  const buffer = await exportWorkbook(input.templateType, input.sheets, {
    context: { now: options.now || DEFAULT_SCENARIO_TIMESTAMP },
  });
  return {
    buffer,
    filename: `${scenario.manifest.scenarioId}-${input.inputId}.xlsx`,
    templateType: input.templateType,
    environmentClass,
    scenario: {
      scenarioId: scenario.manifest.scenarioId,
      scenarioVersion: scenario.manifest.scenarioVersion,
      productionForbidden: scenario.manifest.productionForbidden,
    },
    provenance: {
      sourceType: input.sourceType,
      fixtureClass: scenario.manifest.fixtureClass,
    },
  };
}

function emptyEnterpriseSheets() {
  return Object.fromEntries(Object.keys(WORKBOOK_SHEETS).map((sheetName) => [sheetName, []]));
}

function appendSheets(target, sheets = {}) {
  for (const [sheetName, rows] of Object.entries(sheets || {})) {
    if (!Object.prototype.hasOwnProperty.call(target, sheetName) || !Array.isArray(rows)) continue;
    target[sheetName].push(...rows.map((row) => ({ ...row })));
  }
}

function buildPreviewRows(diagnostics, scenarioId) {
  return diagnostics.map((diagnostic, index) => ({
    id: `scenario:${scenarioId}:${index + 1}`,
    sheet_name: diagnostic.sheetName,
    workbook_row_number: diagnostic.workbookRowNumber,
    workbook_record_id: diagnostic.workbookRecordId,
    validation_status: diagnostic.validationStatus,
    action_type: diagnostic.actionType,
    target_table: diagnostic.targetTable,
    normalized_payload: diagnostic.normalizedPayload,
    row_payload: diagnostic.rowPayload,
  }));
}

function findOrder(combinedSheets, orderId) {
  return (combinedSheets.DIASPORA_IMPORT_ORDERS || []).find((row) => String(row.IMPORT_ORDER_ID) === String(orderId));
}

function findQuote(combinedSheets, quoteId) {
  return (combinedSheets.IMPORT_QUOTES || []).find((row) => String(row.QUOTE_ID) === String(quoteId));
}

function evaluateAssertion(assertion, context) {
  const { combinedSheets, combinedDryRun, importPlan, manifest } = context;
  let actual;
  let description = assertion.type;

  switch (assertion.type) {
    case TRADE_SCENARIO_ASSERTION_TYPES.DRY_RUN_CAN_IMPORT:
      actual = combinedDryRun.canImport;
      description = 'Combined strict enterprise dry-run can proceed to reviewed import.';
      break;
    case TRADE_SCENARIO_ASSERTION_TYPES.SHEET_ROW_COUNT:
      actual = (combinedSheets[assertion.sheetName] || []).length;
      description = `${assertion.sheetName} contains the expected number of scenario rows.`;
      break;
    case TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_COUNT_FOR_ORDER:
      actual = (combinedSheets.IMPORT_QUOTES || []).filter((row) => String(row.IMPORT_ORDER_ID) === String(assertion.orderId)).length;
      description = `Order ${assertion.orderId} retains the expected number of competing quotes.`;
      break;
    case TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_STATUS:
      actual = findQuote(combinedSheets, assertion.quoteId)?.STATUS || null;
      description = `Quote ${assertion.quoteId} preserves its source status.`;
      break;
    case TRADE_SCENARIO_ASSERTION_TYPES.QUOTE_CURRENCY:
      actual = findQuote(combinedSheets, assertion.quoteId)?.QUOTE_CURRENCY || null;
      description = `Quote ${assertion.quoteId} preserves its original source currency.`;
      break;
    case TRADE_SCENARIO_ASSERTION_TYPES.ORDER_SERVICE_SCOPE:
      actual = findOrder(combinedSheets, assertion.orderId)?.SERVICE_SCOPE || null;
      description = `Order ${assertion.orderId} preserves its explicit service scope.`;
      break;
    case TRADE_SCENARIO_ASSERTION_TYPES.ORDER_FIELD_PRESENT: {
      const value = findOrder(combinedSheets, assertion.orderId)?.[assertion.field];
      actual = value !== null && value !== undefined && String(value).trim() !== '';
      description = `Order ${assertion.orderId} has ${assertion.field}.`;
      break;
    }
    case TRADE_SCENARIO_ASSERTION_TYPES.ORDER_FIELD_ABSENT: {
      const value = findOrder(combinedSheets, assertion.orderId)?.[assertion.field];
      actual = value === null || value === undefined || String(value).trim() === '';
      description = `Order ${assertion.orderId} does not require ${assertion.field}.`;
      break;
    }
    case TRADE_SCENARIO_ASSERTION_TYPES.IMPORT_PLAN_BLOCKED_COUNT:
      actual = importPlan.totals.blockedActions;
      description = 'Scenario preview has no rows blocked by the governed import planner.';
      break;
    case TRADE_SCENARIO_ASSERTION_TYPES.PRODUCTION_FORBIDDEN:
      actual = manifest.productionForbidden === true;
      description = 'Scenario is explicitly production-forbidden.';
      break;
    default:
      return {
        id: assertion.id,
        type: assertion.type,
        pass: false,
        expected: assertion.expected,
        actual: null,
        description: `Unknown assertion type: ${assertion.type}`,
        errorCode: 'UNKNOWN_SCENARIO_ASSERTION_TYPE',
      };
  }

  return {
    id: assertion.id,
    type: assertion.type,
    pass: actual === assertion.expected,
    expected: assertion.expected,
    actual,
    description,
    errorCode: null,
  };
}

function expectedEntityCountAssertions(manifest, combinedSheets) {
  return Object.entries(manifest.expectedEntityCounts || {}).map(([sheetName, expected]) => {
    const actual = (combinedSheets[sheetName] || []).length;
    return {
      id: `COUNT-${sheetName}`,
      type: TRADE_SCENARIO_ASSERTION_TYPES.SHEET_ROW_COUNT,
      pass: actual === expected,
      expected,
      actual,
      description: `${sheetName} contains the manifest-declared entity count.`,
      errorCode: null,
    };
  });
}

function sanitizeImportPlanAction(action) {
  return {
    rowId: action.rowId,
    sheetName: action.sheetName,
    workbookRowNumber: action.workbookRowNumber,
    workbookRecordId: action.workbookRecordId,
    targetTable: action.targetTable,
    serviceOwner: action.serviceOwner,
    proposedAction: action.proposedAction,
    riskLevel: action.riskLevel,
    requiresApproval: action.requiresApproval,
    requiresReview: action.requiresReview,
    blocked: action.blocked,
    blockedReason: action.blockedReason,
    sourceValidationStatus: action.sourceValidationStatus,
  };
}

export async function previewDiasporaTradeScenario(scenarioId, userContext = {}, options = {}) {
  const scenario = getScenarioOrThrow(scenarioId);
  const manifest = scenario.manifest;
  const environmentClass = assertTradeScenarioAllowed(manifest, options);
  const runId = options.runId || `scenario_preview_${manifest.scenarioId}_${Date.now()}`;
  const combinedSheets = emptyEnterpriseSheets();
  const referencePacks = manifest.referencePackDependencies.map((id) => getReferencePackOrThrow(id));

  for (const pack of referencePacks) appendSheets(combinedSheets, pack.sheets);

  const perInput = [];
  for (const input of scenario.workbooks) {
    const generated = await generateDiasporaTradeScenarioWorkbook(manifest.scenarioId, input.inputId, {
      ...options,
      environmentClass,
    });
    const parsed = await parseWorkbook(generated.buffer, { templateType: input.templateType });
    const dryRunPayload = {
      ...parsed,
      scenario: {
        scenarioId: manifest.scenarioId,
        scenarioRunId: runId,
        scenarioVersion: manifest.scenarioVersion,
        productionForbidden: manifest.productionForbidden,
      },
      provenance: {
        sourceType: input.sourceType,
        fixtureClass: manifest.fixtureClass,
      },
    };
    const dryRun = validateDiasporaWorkbookDryRun(dryRunPayload, userContext);
    appendSheets(combinedSheets, parsed.sheets);
    perInput.push({
      inputId: input.inputId,
      templateType: input.templateType,
      sourceType: input.sourceType,
      generatedBytes: generated.buffer.length,
      parsedMeta: parsed.meta,
      dryRun: {
        canImport: dryRun.canImport,
        wroteToDatabase: dryRun.wroteToDatabase,
        totals: dryRun.totals,
        summaries: dryRun.summaries,
        errors: dryRun.errors,
        warnings: dryRun.warnings,
      },
    });
  }

  const combinedPayload = {
    templateType: 'enterprise',
    sheets: combinedSheets,
    scenario: {
      scenarioId: manifest.scenarioId,
      scenarioRunId: runId,
      scenarioVersion: manifest.scenarioVersion,
      productionForbidden: manifest.productionForbidden,
    },
    provenance: manifest.sourceProvenance,
  };
  const combinedDryRun = validateDiasporaWorkbookDryRun(combinedPayload, userContext);
  const diagnostics = buildWorkbookRowDiagnostics(combinedPayload, combinedDryRun);
  const previewRows = buildPreviewRows(diagnostics, manifest.scenarioId);
  const previewBatch = {
    id: `scenario-preview:${manifest.scenarioId}`,
    template_type: 'enterprise',
    import_status: combinedDryRun.canImport ? 'VALIDATED' : 'BLOCKED',
  };
  const importPlan = buildWorkbookImportPlan(previewBatch, previewRows, userContext);
  const assertionContext = { combinedSheets, combinedDryRun, importPlan, manifest };
  const declaredAssertions = (manifest.assertions || []).map((assertion) => evaluateAssertion(assertion, assertionContext));
  const countAssertions = expectedEntityCountAssertions(manifest, combinedSheets);
  const assertionResults = [...countAssertions, ...declaredAssertions];
  const allAssertionsPassed = assertionResults.every((result) => result.pass);
  const everyRoleWorkbookValid = perInput.every((result) => result.dryRun.canImport);
  const readyForReviewedImport = Boolean(
    everyRoleWorkbookValid
      && combinedDryRun.canImport
      && importPlan.totals.blockedActions === 0
      && allAssertionsPassed,
  );

  return {
    scenarioId: manifest.scenarioId,
    scenarioVersion: manifest.scenarioVersion,
    runId,
    environmentClass,
    dryRunOnly: true,
    wroteToDatabase: false,
    productionForbidden: manifest.productionForbidden,
    workbookSchemaVersion: XLSX_SCHEMA_VERSION,
    readyForReviewedImport,
    referencePacks: referencePacks.map(referencePackSummary),
    perInput,
    combinedDryRun,
    importPlan: {
      canProceedToExecution: importPlan.canProceedToExecution,
      requiresApproval: importPlan.requiresApproval,
      blockedReason: importPlan.blockedReason,
      totals: importPlan.totals,
      validation: importPlan.validation,
      actions: importPlan.actions.map(sanitizeImportPlanAction),
    },
    assertions: {
      passed: assertionResults.filter((result) => result.pass).length,
      failed: assertionResults.filter((result) => !result.pass).length,
      allPassed: allAssertionsPassed,
      results: assertionResults,
      deferredPostImportAssertions: manifest.postImportAssertions || [],
    },
  };
}
