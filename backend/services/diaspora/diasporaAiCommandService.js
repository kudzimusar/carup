/**
 * Phase 5 — AI command service.
 *
 * Pipeline: parse → classify intent → extract entities → confidence → duplicate fingerprint →
 * auth/tenant → role → risk tier → draft action → confirm/approve gate → execute via an existing
 * domain service → sealed audit → status. AI never directly mutates domain records; high-risk
 * execution is always blocked (directive §7.4, §23). Execution re-validates permission + risk + gate.
 */
import crypto from 'crypto';
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors.js';
import {
  AI_RISK_TIERS,
  AI_APPROVAL_STATUSES,
  AI_EXECUTION_STATUSES,
  AI_CONFIDENCE_THRESHOLD,
  AI_LOW_RISK_DRAFT_ACTIONS,
  AI_MEDIUM_RISK_EXECUTABLE,
} from '../../constants/diaspora/diasporaAiConstants.js';
import { requireUserContext, isPlatformAdmin, isPlatformReviewer, normalizeId } from './diasporaAuthorization.js';
import { resolveClient, appendAudit } from './diasporaServiceUtils.js';
import { parseCommand } from './diasporaAiIntentParser.js';
import { createBuyerOrder } from './diasporaBuyerOrderService.js';
import { createStockItem, reserveStock } from './diasporaStockService.js';

const TABLE = 'diaspora_ai_commands';

function fingerprint(normalized, requestedBy, intent) {
  return crypto.createHash('sha256').update(`${requestedBy}|${intent || 'none'}|${normalized}`).digest('hex');
}

function canAccess(command, context) {
  return isPlatformAdmin(context) || isPlatformReviewer(context) ||
    normalizeId(command.requested_by) === context.id ||
    (command.tenant_id && context.tenantId && normalizeId(command.tenant_id) === context.tenantId);
}

async function loadCommand(client, id, context) {
  const { data, error } = await client.from(TABLE).select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !data) throw new NotFoundError('AI command not found');
  if (!canAccess(data, context)) throw new ForbiddenError('You do not have access to this AI command');
  return data;
}

/** Parse only — no persistence (POST /ai-commands/parse). */
export function parseAiCommand(rawCommand, userContext = {}) {
  requireUserContext(userContext);
  return parseCommand(rawCommand, userContext);
}

function deriveInitialStatus(parse) {
  if (!parse.intent || parse.ambiguous || parse.confidence < AI_CONFIDENCE_THRESHOLD) {
    return { execution_status: AI_EXECUTION_STATUSES.NEEDS_REVIEW, approval_status: AI_APPROVAL_STATUSES.NOT_REQUIRED };
  }
  if (parse.risk === AI_RISK_TIERS.HIGH) {
    return { execution_status: AI_EXECUTION_STATUSES.AWAITING_APPROVAL, approval_status: AI_APPROVAL_STATUSES.PENDING };
  }
  if (parse.risk === AI_RISK_TIERS.MEDIUM) {
    return { execution_status: AI_EXECUTION_STATUSES.AWAITING_CONFIRMATION, approval_status: AI_APPROVAL_STATUSES.NOT_REQUIRED };
  }
  return { execution_status: AI_EXECUTION_STATUSES.DRAFT, approval_status: AI_APPROVAL_STATUSES.NOT_REQUIRED };
}

export async function createAiCommand(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;

  const rawCommand = payload.rawCommand || payload.raw_command || '';
  if (!String(rawCommand).trim()) throw new ValidationError('rawCommand is required');

  const parse = parseCommand(rawCommand, context);
  const fp = fingerprint(parse.normalized, context.id, parse.intent);

  // Duplicate-command guard: a prior non-rejected command with the same fingerprint is a replay.
  const { data: mine } = await client.from(TABLE).select('*').eq('requested_by', context.id).is('deleted_at', null);
  const dup = (mine || []).find((c) => c.metadata?.fingerprint === fp && c.execution_status !== AI_EXECUTION_STATUSES.REJECTED);
  if (dup) return { command: dup, parse, duplicate: true };

  const status = deriveInitialStatus(parse);
  const row = {
    tenant_id: context.tenantId || null,
    requested_by: context.id,
    raw_command: rawCommand,
    voice_transcript: payload.voiceTranscript || null,
    intent: parse.intent || 'UNKNOWN',
    risk_level: parse.risk || 'LOW',
    confidence_score: parse.confidence,
    target_entity_type: payload.targetEntityType || null,
    target_entity_id: parse.entities?.targetId || payload.targetEntityId || null,
    extracted_entities: parse.entities || {},
    proposed_action: { action: parse.action || null, entities: parse.entities || {} },
    approval_status: status.approval_status,
    execution_status: status.execution_status,
    metadata: { fingerprint: fp, reasons: parse.reasons, ambiguous: parse.ambiguous, missing: parse.missing || [], source: payload.source || 'ui' },
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(TABLE).insert(row).select().single();
  if (error) throw new ValidationError(`Failed to create AI command: ${error.message}`);

  await appendAudit(client, { actorId: context.id, tenantId: data.tenant_id, action: 'AI_COMMAND_CREATED', resourceType: 'diaspora_ai_command', resourceId: data.id, newState: data, metadata: { intent: data.intent, risk: data.risk_level }, req });
  return { command: data, parse, duplicate: false };
}

export async function listAiCommands(filters = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  let query = client.from(TABLE).select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (context.tenantId) query = query.eq('tenant_id', context.tenantId);
  if (!isPlatformAdmin(context) && !isPlatformReviewer(context) && !context.tenantId) {
    query = query.eq('requested_by', context.id);
  }
  const { data, error } = await query;
  if (error) throw new ValidationError(`Failed to list AI commands: ${error.message}`);
  return data || [];
}

export async function getAiCommand(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  return loadCommand(client, id, context);
}

/** Medium-risk confirmation by the requester or a reviewer/admin. */
export async function confirmAiCommand(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const command = await loadCommand(client, id, context);

  const isRequester = normalizeId(command.requested_by) === context.id;
  if (!isRequester && !isPlatformReviewer(context) && !isPlatformAdmin(context)) {
    throw new ForbiddenError('Only the requester or a reviewer can confirm this command');
  }
  if (command.execution_status !== AI_EXECUTION_STATUSES.AWAITING_CONFIRMATION) {
    throw new ValidationError(`Command is not awaiting confirmation (status: ${command.execution_status})`);
  }

  const { data, error } = await client.from(TABLE).update({ execution_status: AI_EXECUTION_STATUSES.CONFIRMED, updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw new ValidationError(`Failed to confirm command: ${error.message}`);
  await appendAudit(client, { actorId: context.id, tenantId: data.tenant_id, action: 'AI_COMMAND_CONFIRMED', resourceType: 'diaspora_ai_command', resourceId: id, previousState: command, newState: data, req });
  return data;
}

/** High-risk approval — reviewer/admin only. Approval does NOT enable execution in this program. */
export async function approveAiCommand(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const command = await loadCommand(client, id, context);

  if (!isPlatformReviewer(context) && !isPlatformAdmin(context)) {
    throw new ForbiddenError('Only a reviewer or admin can approve a high-risk command');
  }
  if (command.approval_status !== AI_APPROVAL_STATUSES.PENDING) {
    throw new ValidationError(`Command is not pending approval (status: ${command.approval_status})`);
  }

  const { data, error } = await client.from(TABLE).update({
    approval_status: AI_APPROVAL_STATUSES.APPROVED,
    approved_by: context.id,
    approved_at: new Date().toISOString(),
    updated_by: context.id,
    updated_at: new Date().toISOString(),
    metadata: { ...(command.metadata || {}), approvalNote: 'High-risk execution remains blocked in this program.' },
  }).eq('id', id).select().single();
  if (error) throw new ValidationError(`Failed to approve command: ${error.message}`);
  await appendAudit(client, { actorId: context.id, tenantId: data.tenant_id, action: 'AI_COMMAND_APPROVED', resourceType: 'diaspora_ai_command', resourceId: id, previousState: command, newState: data, req });
  return data;
}

export async function rejectAiCommand(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const command = await loadCommand(client, id, context);

  if (!isPlatformReviewer(context) && !isPlatformAdmin(context) && normalizeId(command.requested_by) !== context.id) {
    throw new ForbiddenError('Only the requester or a reviewer can reject this command');
  }

  const { data, error } = await client.from(TABLE).update({
    approval_status: AI_APPROVAL_STATUSES.REJECTED,
    execution_status: AI_EXECUTION_STATUSES.REJECTED,
    updated_by: context.id,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select().single();
  if (error) throw new ValidationError(`Failed to reject command: ${error.message}`);
  await appendAudit(client, { actorId: context.id, tenantId: data.tenant_id, action: 'AI_COMMAND_REJECTED', resourceType: 'diaspora_ai_command', resourceId: id, previousState: command, newState: data, req });
  return data;
}

/** Execute the draft action through an existing domain service. Never a direct domain mutation. */
async function executeDomainAction(command, context, options) {
  const action = command.proposed_action?.action;
  const entities = command.extracted_entities || {};

  switch (action) {
    case 'CREATE_BUYER_REQUEST': {
      const order = await createBuyerOrder({ order_type: 'parts', origin_country: entities.origin || 'UNSPECIFIED', requested_make: entities.make || null, metadata: { source: 'ai_command', commandId: command.id, draft: true } }, context, options);
      return { type: 'buyer_order_draft', id: order.id };
    }
    case 'CREATE_SUPPLIER_STOCK': {
      const item = await createStockItem({ part_name: entities.partName || `AI draft stock (${command.id})`, metadata: { source: 'ai_command', commandId: command.id, draft: true } }, context, options);
      return { type: 'stock_item_draft', id: item.id };
    }
    case 'RESERVE_STOCK': {
      if (!entities.targetId || !(entities.quantity > 0)) throw new ValidationError('RESERVE_STOCK requires a targetId and positive quantity');
      const result = await reserveStock(entities.targetId, { quantity: entities.quantity, idempotencyKey: `ai:${command.id}`, source: 'ai_command' }, context, options);
      return { type: 'stock_reservation', stockItemId: entities.targetId, ledgerEntryId: result.ledgerEntry.id };
    }
    case 'ADD_NOTE':
    case 'CLASSIFY_DOCUMENT':
    case 'PREPARE_QUOTE':
      return { type: 'draft_only', action };
    default:
      throw new ForbiddenError(`Execution is not permitted for intent ${command.intent}`);
  }
}

export async function executeAiCommand(id, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { req = null } = options;
  const command = await loadCommand(client, id, context);

  // Idempotent replay.
  if (command.execution_status === AI_EXECUTION_STATUSES.EXECUTED) {
    return { command, result: command.metadata?.executionResult || null, idempotentReplay: true };
  }

  // Re-validate at execution time — never trust parse-time authorization.
  if (command.execution_status === AI_EXECUTION_STATUSES.NEEDS_REVIEW) {
    throw new ValidationError('Command needs human review (low confidence or ambiguous) and cannot execute');
  }
  if (command.execution_status === AI_EXECUTION_STATUSES.REJECTED) {
    throw new ValidationError('Command was rejected and cannot execute');
  }

  // High-risk execution is always blocked in this program, even when approved.
  if (command.risk_level === AI_RISK_TIERS.HIGH) {
    await client.from(TABLE).update({ execution_status: AI_EXECUTION_STATUSES.BLOCKED, updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    await appendAudit(client, { actorId: context.id, tenantId: command.tenant_id, action: 'AI_COMMAND_EXECUTION_BLOCKED', resourceType: 'diaspora_ai_command', resourceId: id, metadata: { intent: command.intent, risk: command.risk_level }, req });
    throw new ForbiddenError('High-risk AI execution is disabled in this program and remains queued for manual handling');
  }

  // Medium-risk must be confirmed first.
  if (command.risk_level === AI_RISK_TIERS.MEDIUM && command.execution_status !== AI_EXECUTION_STATUSES.CONFIRMED) {
    throw new ValidationError('Medium-risk command requires confirmation before execution');
  }

  // Only low-risk draft actions and confirmed, explicitly-executable medium actions proceed.
  const action = command.proposed_action?.action;
  const executable = AI_LOW_RISK_DRAFT_ACTIONS.includes(action) || (command.risk_level === AI_RISK_TIERS.MEDIUM && AI_MEDIUM_RISK_EXECUTABLE.includes(action));
  if (!executable) {
    throw new ForbiddenError(`Execution is not permitted for intent ${command.intent}`);
  }

  let result;
  try {
    result = await executeDomainAction(command, context, options);
  } catch (err) {
    await client.from(TABLE).update({ execution_status: AI_EXECUTION_STATUSES.FAILED, error_message: err.message, updated_by: context.id, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    await appendAudit(client, { actorId: context.id, tenantId: command.tenant_id, action: 'AI_COMMAND_EXECUTION_FAILED', resourceType: 'diaspora_ai_command', resourceId: id, metadata: { error: err.message }, req });
    throw err;
  }

  const { data, error } = await client.from(TABLE).update({
    execution_status: AI_EXECUTION_STATUSES.EXECUTED,
    executed_at: new Date().toISOString(),
    updated_by: context.id,
    updated_at: new Date().toISOString(),
    metadata: { ...(command.metadata || {}), executionResult: result },
  }).eq('id', id).select().single();
  if (error) throw new ValidationError(`Failed to finalize execution: ${error.message}`);

  await appendAudit(client, { actorId: context.id, tenantId: data.tenant_id, action: 'AI_COMMAND_EXECUTED', resourceType: 'diaspora_ai_command', resourceId: id, previousState: command, newState: data, metadata: { result }, req });
  return { command: data, result, idempotentReplay: false };
}
