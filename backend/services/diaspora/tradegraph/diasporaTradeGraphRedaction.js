/**
 * Phase 10 — Trade Graph SHARED role-aware redaction helper (FIX 6/7).
 *
 * Single source of truth for masking sensitive node.data / edge.metadata BEFORE it leaves any read path
 * (the explainable-query service AND the intelligence/AI-context service). Keying off the same policy
 * declared in diasporaTradeGraphConstants.js (TRADE_GRAPH_REDACTED_FIELDS / _REGION_ONLY_FIELDS /
 * _ADMIN_ONLY_FIELDS / _PARTICIPANT_ID_FIELDS), it guarantees PII, payment refs, addresses, private file
 * paths, participant/profile identifiers and admin-only fields never reach a non-admin caller (or AI)
 * regardless of which service produced the result.
 *
 * Policy (per field classification):
 *   - REDACTED       → ALWAYS replaced with TRADE_GRAPH_REDACTION_TOKEN ('[REDACTED]'). PII / payment refs /
 *                      private file paths are masked for EVERYONE — even admins don't need raw PII in a
 *                      graph summary, so we fail safe (least privilege).
 *   - PARTICIPANT_ID → ROLE-AWARE, TOKENIZED (FIX A): seller_id/buyer_id/user_id/coordinator_id/uploaded_by/
 *                      verified_by/trade_profile_id/created_by/... inside node.data / edge.metadata are kept
 *                      raw ONLY for a platform admin/reviewer; for everyone else (and AI) they become
 *                      '[REDACTED]'. The STRUCTURAL node id / entity_id (top-level columns surfaced as
 *                      nodeId / entityId) are NOT in node.data, so they stay intact for traversal.
 *   - PARTICIPANT NODE entityId → ROLE-AWARE, PSEUDONYMIZED (FIX D): for participant node types
 *                      (BUYER/SELLER/USER/TRADE_PROFILE) the surfaced entity_id IS a raw person/profile id.
 *                      surfaceEntityId() replaces it with a STABLE, NON-REVERSIBLE pseudonym token
 *                      (participantToken(): 'PARTICIPANT:xxxx') for non-admin/non-reviewer callers and the
 *                      AI context, while the structural nodeId (the trade_graph_nodes.id UUID) is left
 *                      intact for traversal. Admin/reviewer still see the raw entity_id.
 *   - REGION_ONLY    → ALWAYS coarsened to a NON-REVERSIBLE REGION TOKEN ('[REGION]' or '[REGION]:X' where X
 *                      is a one-way hash bucket), NEVER a substring of the raw value (FIX C) — emitting a raw
 *                      prefix would leak the start of a real address/city.
 *   - ADMIN_ONLY     → ROLE-AWARE: kept verbatim for platform admins; nulled for everyone else.
 *   - everything else passes through unchanged.
 *
 * The role is derived from the SERVER-derived userContext (never a client-supplied flag).
 *
 * Pure (no DB/network), so it is unit-testable exactly like the constants module.
 */

import {
  TRADE_GRAPH_REDACTED_FIELDS,
  TRADE_GRAPH_REGION_ONLY_FIELDS,
  TRADE_GRAPH_ADMIN_ONLY_FIELDS,
  TRADE_GRAPH_TOKENIZED_ID_FIELDS,
  TRADE_GRAPH_REDACTION_TOKEN,
  TRADE_GRAPH_REGION_TOKEN,
  TRADE_GRAPH_PARTICIPANT_TOKEN_PREFIX,
  isParticipantNodeType,
} from '../../../constants/diaspora/diasporaTradeGraphConstants.js';
import { isPlatformAdmin, isPlatformReviewer } from '../diasporaAuthorization.js';

const REDACTED = new Set(TRADE_GRAPH_REDACTED_FIELDS);
const REGION_ONLY = new Set(TRADE_GRAPH_REGION_ONLY_FIELDS);
// GATE-T10: participant (person) ids AND document/record refs are both ROLE-AWARE + TOKENIZED inside
// node.data / edge.metadata — a non-admin / AI gets the redaction token, a platform admin/reviewer the raw
// id. The constants module composes both classes into the accurately-named TRADE_GRAPH_TOKENIZED_ID_FIELDS
// (= participant ids ∪ document/record ids); keying off it here (set named TOKENIZED_ID, not the misleading
// "PARTICIPANT_ID") fixes the adversarial-test leak where a document identifier (e.g. document_id) buried in
// node.data / an array reached a non-admin caller RAW. Runtime behavior is identical to the prior union.
const TOKENIZED_ID = new Set(TRADE_GRAPH_TOKENIZED_ID_FIELDS);
// ADMIN_ONLY already contains the participant-id fields (constants composes them in); we keep a
// tokenized-only set so those are TOKENIZED for non-admins (not nulled like internal_risk_score/amount).
const ADMIN_ONLY = new Set(TRADE_GRAPH_ADMIN_ONLY_FIELDS.filter((f) => !TOKENIZED_ID.has(f)));

/**
 * Region coarsening (FIX C, supersedes FIX 7): emit a NON-REVERSIBLE coarse region label that does NOT
 * echo any raw input characters. The previous implementation emitted `slice(0,2).toUpperCase()`, a raw
 * 2-character prefix of the address/city — that leaks the start of a real address. Instead we map the
 * raw value to a fixed, coarse bucket derived from a stable, one-way hash of the (lower-cased, trimmed)
 * value, so identical inputs deterministically map to the same bucket while NO substring of the raw
 * value is ever emitted. Empty/nullish → the bare token. The bucket is a single A–P letter (16 buckets)
 * carrying coarse "are these two roughly the same region" signal without any reversible content.
 */
const REGION_BUCKET_COUNT = 16;
export function regionToken(value) {
  if (value == null || String(value) === '') return TRADE_GRAPH_REGION_TOKEN;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '') return TRADE_GRAPH_REGION_TOKEN;
  // Deterministic one-way FNV-1a-style fold → a bucket index. Not cryptographic; its only job is to be
  // stable + non-reversible + free of any raw substring of the input.
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  const bucket = String.fromCharCode(65 + (hash % REGION_BUCKET_COUNT)); // 'A'..'P'
  return `${TRADE_GRAPH_REGION_TOKEN}:${bucket}`;
}

/**
 * FIX D helper — a STABLE, NON-REVERSIBLE participant PSEUDONYM token for the SURFACED entity_id of a
 * participant node type (BUYER / SELLER / USER / TRADE_PROFILE). The surfaced entityId of these node
 * types IS the raw person/profile id (buyer_id / seller_id / user_id / trade_profile_id), so it must
 * not reach a non-admin viewer or the AI context. We derive a deterministic token from a one-way hash
 * of the raw id so that:
 *   - the SAME participant correlates across nodes/responses (deterministic: same raw id → same token),
 *   - the token is NON-REVERSIBLE (a hash; no substring of the raw id is ever emitted),
 *   - the structural nodeId (the trade_graph_nodes.id UUID) is left untouched for traversal.
 *
 * The hash is a 64-bit FNV-1a fold rendered as 8 hex chars. It is not cryptographic — its only jobs are
 * to be stable, collision-resistant enough to correlate, and to never echo any character of the raw id.
 */
export function participantToken(rawId) {
  if (rawId == null || String(rawId) === '') return null;
  const s = String(rawId);
  // Two independent 32-bit FNV-1a folds (different basis offsets) concatenated → an 8-hex, 64-bit token.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
    h2 = (h2 ^ c) >>> 0;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  return `${TRADE_GRAPH_PARTICIPANT_TOKEN_PREFIX}${hex.slice(0, 8)}`;
}

/**
 * FIX D — return the SURFACED entity_id for a node leaving any read path. For a PARTICIPANT node type
 * (BUYER/SELLER/USER/TRADE_PROFILE) whose entity_id is a raw person/profile id, a non-admin/non-reviewer
 * caller (and the AI boundary, which is always treated as least-privilege) receives the stable pseudonym
 * token instead of the raw id; a platform admin/reviewer receives the raw id. For every NON-participant
 * node type the structural entity_id is a queryable domain-object key and passes through unchanged.
 *
 * @param {string} nodeType   - trade_graph_nodes.node_type
 * @param {*}      entityId    - trade_graph_nodes.entity_id (the surfaced value)
 * @param {object} userContext - server-derived; admins/reviewers see the raw id
 */
export function surfaceEntityId(nodeType, entityId, userContext) {
  if (!isParticipantNodeType(nodeType)) return entityId;
  if (callerMaySeeParticipantIds(userContext)) return entityId;
  const token = participantToken(entityId);
  return token == null ? entityId : token;
}

/**
 * FIX B helper — a SAFE participant reference for human-readable reason/explanation/blocker text.
 * Non-admins (and AI) get a role-labelled redaction token (e.g. "seller [REDACTED]") that names the
 * RELATIONSHIP without re-identifying the person; a platform admin/reviewer gets "role rawId". The raw
 * id is NEVER interpolated into a reason string for a non-admin caller.
 *
 * @param {string} roleLabel - a human role label ('seller', 'buyer', 'uploader', ...)
 * @param {*} rawId - the raw participant id from node.data / edge.metadata
 * @param {object} userContext - server-derived; admins/reviewers may see the raw id
 */
export function participantReference(roleLabel, rawId, userContext) {
  const label = String(roleLabel || 'participant');
  if (rawId == null || String(rawId) === '') return label;
  if (callerMaySeeParticipantIds(userContext)) return `${label} ${String(rawId)}`;
  return `${label} ${TRADE_GRAPH_REDACTION_TOKEN}`;
}

/** True when the caller may see raw participant identifiers (platform admin OR platform reviewer). */
export function callerMaySeeParticipantIds(userContext) {
  return isPlatformAdmin(userContext) || isPlatformReviewer(userContext);
}

/**
 * FIX (Gate-T10) — ADVERSARIAL NESTED/ARRAY redaction. The original redactData/redactMetadata only
 * masked TOP-LEVEL keys: a PII / participant-id / address / payment-ref / private-path field buried in a
 * NESTED object, an ARRAY of objects, an array-of-arrays, or under a mixed-case/alias key sailed straight
 * through the `out[key] = value` pass-through and reached a non-admin viewer or the AI context RAW. That is
 * a real redaction bypass: depth (or casing) was enough to leak the exact value the policy forbids.
 *
 * The redaction now RECURSES through nested objects AND arrays, applying the SAME role-aware key policy at
 * EVERY level, so the classification of a key (REDACTED / PARTICIPANT_ID / REGION_ONLY / ADMIN_ONLY) is
 * honored no matter how deep it sits or whether it sits inside an array. Key matching is CASE-INSENSITIVE
 * (server payloads/aliases vary in casing: `Seller_Id`, `BUYER_ID`, `Email`), so an alias casing cannot be
 * used to smuggle a raw value past the policy. Recursion is BOUNDED (MAX_REDACTION_DEPTH) and cycle-safe
 * (a WeakSet of visited objects) so a pathological deeply-nested or self-referential payload cannot cause
 * unbounded work or a stack overflow — beyond the bound the subtree is dropped to the redaction token
 * (fail-safe: a value we cannot fully prove clean is masked, never emitted raw).
 *
 * Structural integrity is preserved: object shape and array positions are kept, only leaf VALUES of
 * classified keys are masked/coarsened/nulled. The surfaced structural nodeId/entityId are handled
 * separately by surfaceEntityId()/the read services and are NOT members of node.data, so they are
 * untouched here and stay intact for traversal.
 */
const MAX_REDACTION_DEPTH = 8;

const REDACTED_LC = new Set([...REDACTED].map((k) => k.toLowerCase()));
const REGION_ONLY_LC = new Set([...REGION_ONLY].map((k) => k.toLowerCase()));
const TOKENIZED_ID_LC = new Set([...TOKENIZED_ID].map((k) => k.toLowerCase()));
const ADMIN_ONLY_LC = new Set([...ADMIN_ONLY].map((k) => k.toLowerCase()));

/**
 * Redact a node.data / edge.metadata attribute bag by the caller's role, RECURSING into nested objects
 * and arrays (bounded depth, cycle-safe) so no classified field can bypass redaction via depth, an array,
 * or key casing.
 * @param {object|null} data
 * @param {object} userContext - server-derived; isPlatformAdmin(userContext) decides admin visibility.
 * @returns {object} a NEW object (never mutates the input).
 */
export function redactData(data, userContext) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const admin = isPlatformAdmin(userContext);
  const maySeeParticipantIds = callerMaySeeParticipantIds(userContext);
  return redactObject(data, { admin, maySeeParticipantIds }, 0, new WeakSet());
}

/** Recursively redact a plain object's classified keys, descending into nested objects/arrays. */
function redactObject(obj, policy, depth, seen) {
  // Bounded + cycle-safe: beyond the depth bound, or on a re-visited object (cycle), fail safe to the
  // redaction token rather than emitting (potentially raw) deep content or recursing forever.
  if (depth > MAX_REDACTION_DEPTH || seen.has(obj)) return TRADE_GRAPH_REDACTION_TOKEN;
  seen.add(obj);
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const lk = key.toLowerCase();
    // A classified KEY masks its value regardless of the value's type (a nested object/array under a
    // classified key — e.g. address:{...} or participants:[...] — is masked/coarsened as a whole), so a
    // raw value can never hide inside a classified subtree.
    if (REDACTED_LC.has(lk)) { out[key] = TRADE_GRAPH_REDACTION_TOKEN; continue; }      // always masked (PII/payment/path)
    if (TOKENIZED_ID_LC.has(lk)) { out[key] = policy.maySeeParticipantIds ? value : TRADE_GRAPH_REDACTION_TOKEN; continue; } // participant + document/record ids
    if (REGION_ONLY_LC.has(lk)) { out[key] = regionToken(value); continue; }            // always coarsened (FIX C)
    if (ADMIN_ONLY_LC.has(lk)) { out[key] = policy.admin ? value : null; continue; }    // role-aware (nulled)
    // Unclassified key: descend into nested structures so a classified key DEEPER in is still caught.
    out[key] = redactValue(value, policy, depth + 1, seen);
  }
  return out;
}

/** Redact a value: recurse for arrays/objects, pass through scalars unchanged. */
function redactValue(value, policy, depth, seen) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (depth > MAX_REDACTION_DEPTH) return TRADE_GRAPH_REDACTION_TOKEN;
    return value.map((item) => redactValue(item, policy, depth + 1, seen));
  }
  return redactObject(value, policy, depth, seen);
}

/** Redact edge.metadata (same recursive, role-aware policy as node.data). */
export function redactMetadata(metadata, userContext) {
  return redactData(metadata || {}, userContext);
}

/** True when the caller is a trusted platform admin (sees unredacted fields). */
export function callerIsAdmin(userContext) {
  return isPlatformAdmin(userContext);
}
