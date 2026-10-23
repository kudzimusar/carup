
import { supabase as defaultClient } from '../../db/supabase.js';
import {
  GARAGE_ADMIN_ROLES,
  GARAGE_WORKSPACE_ROLES,
  requireGarageTenant,
} from '../serviceNetwork/serviceAuthority.js';
import {
  ConflictError, DatabaseError, ForbiddenError, NotFoundError, ValidationError,
} from '../../utils/errors.js';

const TERMINAL = new Set(['declined', 'cancelled', 'fulfilled', 'no_show']);
const GARAGE_STATUS_TARGETS = new Set(['declined', 'cancelled', 'fulfilled', 'no_show']);
const REASON_CODES = new Set(['leave', 'training', 'unavailable', 'other']);

function actorId(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
}
function workspaceTenant(actor) { return requireGarageTenant(actor, GARAGE_WORKSPACE_ROLES); }
function adminTenant(actor) { return requireGarageTenant(actor, GARAGE_ADMIN_ROLES); }
function tenantRole(actor) { return actor?.activeTenant?.role || null; }

function requiredString(value, label, max = 200) {
  const clean = String(value ?? '').trim();
  if (!clean) throw new ValidationError(label + ' is required');
  if (clean.length > max) throw new ValidationError(label + ' must be at most ' + max + ' characters');
  return clean;
}
function integer(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(label + ' must be an integer between ' +¶»§q«^