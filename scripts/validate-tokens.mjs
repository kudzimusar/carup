/**
 * RX-02A S1-1 (R3) — token-package schema validation.
 *
 * Implements every rule declared in shared/schemas/token-package.schema.json
 * (the $schema authority referenced by shared/tokens/tokens.json) as a
 * dependency-free structural validator. Where the JSON Schema document and
 * this implementation disagree, that is a bug — keep them in lockstep.
 *
 * Validation layers:
 *   1. shape        — required top-level sections, key formats, primitive types
 *   2. references   — semantic/status/shadcn name references resolve into raw
 *   3. scales       — numeric spacing/radius/type/breakpoint/content widths
 *   4. status rules — every status carries lightInk/lightSoft/darkInk/darkSoftRgba;
 *                     darkSoftRgba composites to a valid result on darkSoftBase
 *
 * CLI:  node scripts/validate-tokens.mjs [path-to-tokens.json]
 * Exit 0 when valid; exit 1 with a per-rule error report otherwise.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_TOKENS = join(ROOT, 'shared', 'tokens', 'tokens.json')
const SCHEMA = join(ROOT, 'shared', 'schemas', 'token-package.schema.json')

export function validateTokens(tokens, schemaPath = SCHEMA) {
  // The schema file must exist and be itself valid JSON — it is the declared authority.
  JSON.parse(readFileSync(schemaPath, 'utf8'))
  const errors = []
  const err = (rule, msg) => errors.push(`${rule}: ${msg}`)

  /* ── 1. shape ─────────────────────────────────────────────────────── */
  const REQUIRED = ['$schema', 'meta', 'fonts', 'raw', 'semantic', 'status', 'darkSoftBase', 'spacing', 'radius', 'type', 'breakpoints', 'contentWidths', 'elevation', 'shadcnSlots']
  if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) {
    return ['shape: token package must be a JSON object']
  }
  for (const k of REQUIRED) if (!(k in tokens)) err('shape', `missing required section "${k}"`)
  if (!String(tokens.$schema ?? '').endsWith('.schema.json')) err('shape', '$schema must point to a .schema.json authority')
  for (const k of Object.keys(tokens)) {
    if (k !== '$schema' && !/^[a-z][a-zA-Z0-9-]*$/.test(k)) err('shape', `unexpected top-level key "${k}"`)
  }

  const HEX = /^#[0-9A-Fa-f]{6}$/
  const RGBA = /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/
  const isName = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v) && !v.startsWith('#') && !v.startsWith('rgba')

  if (tokens.meta) {
    const m = tokens.meta
    for (const k of ['name', 'version', 'programme', 'stage', 'sourceOfTruth']) {
      if (!(k in m)) err('shape', `meta missing "${k}"`)
    }
    if (m.sourceOfTruth !== true) err('shape', 'meta.sourceOfTruth must be true')
  }
  if (tokens.fonts) {
    for (const fam of ['sans', 'mono']) {
      const f = tokens.fonts[fam]
      if (!f || typeof f !== 'object') { err('shape', `fonts.${fam} must be an object`); continue }
      if (!Array.isArray(f.weightsShipped) || f.weightsShipped.length === 0 || !f.weightsShipped.every((w) => Number.isInteger(w))) {
        err('shape', `fonts.${fam}.weightsShipped must be a non-empty integer array`)
      }
    }
  }

  /* ── 2. references ────────────────────────────────────────────────── */
  const raw = tokens.raw ?? {}
  if (typeof raw !== 'object' || Object.keys(raw).length === 0) {
    err('raw', 'raw palette must be a non-empty map')
  }
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9-]*$/.test(k)) err('raw', `invalid raw key "${k}"`)
    if (!HEX.test(String(v))) err('raw', `raw.${k} must be an opaque 6-digit hex color, got ${JSON.stringify(v)}`)
  }

  const resolveRef = (value, layer, key) => {
    const v = String(value)
    if (HEX.test(v) || RGBA.test(v)) return v
    if (isName(v)) {
      if (v in raw) return raw[v]
      err('reference', `${layer}.${key} references unknown raw name "${v}"`)
      return v
    }
    err('reference', `${layer}.${key} is neither hex, rgba(), nor a raw name: ${JSON.stringify(value)}`)
    return v
  }

  if (tokens.semantic) {
    for (const [layer, map] of Object.entries(tokens.semantic)) {
      if (typeof map !== 'object') { err('shape', `semantic.${layer} must be an object`); continue }
      for (const [k, v] of Object.entries(map)) {
        if (k === '_note') continue
        if (!/^[a-z][a-z0-9-]*$/.test(k)) err('shape', `semantic.${layer} invalid key "${k}"`)
        resolveRef(v, `semantic.${layer}`, k)
      }
    }
  }
  if (tokens.shadcnSlots?.light) {
    const SLOTS = ['background', 'foreground', 'card', 'primary', 'muted', 'border', 'input', 'ring', 'radius']
    for (const s of SLOTS) {
      if (!(s in tokens.shadcnSlots.light)) err('shape', `shadcnSlots.light missing required slot "${s}"`)
    }
    for (const [k, v] of Object.entries(tokens.shadcnSlots.light)) {
      if (k === 'radius') continue // length slot, not a color
      resolveRef(v, 'shadcnSlots.light', k)
    }
  }

  /* ── 3. status rules + scales ─────────────────────────────────────── */
  if (tokens.status) {
    const entries = Object.entries(tokens.status)
    if (entries.length < 6) err('status', `expected at least 6 status entries, got ${entries.length}`)
    for (const [name, st] of entries) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) err('status', `invalid status name "${name}"`)
      for (const k of ['lightInk', 'lightSoft', 'darkInk', 'darkSoftRgba']) {
        if (!(k in st)) err('status', `status.${name} missing "${k}"`)
      }
      if (!st) continue
      if (st.darkInk && !HEX.test(String(st.darkInk))) err('status', `status.${name}.darkInk must be opaque hex`)
      if (st.darkSoftRgba && !RGBA.test(String(st.darkSoftRgba))) err('status', `status.${name}.darkSoftRgba must be rgba()`)
      if (st.lightInk) resolveRef(st.lightInk, `status.${name}`, 'lightInk')
      if (st.lightSoft) resolveRef(st.lightSoft, `status.${name}`, 'lightSoft')
    }
  }
  if (tokens.darkSoftBase && !HEX.test(String(tokens.darkSoftBase))) err('status', 'darkSoftBase must be opaque hex')
  if (tokens.spacing && (!Array.isArray(tokens.spacing) || !tokens.spacing.every((n) => Number.isInteger(n) && n > 0))) {
    err('scales', 'spacing must be an array of positive integers')
  }
  if (tokens.radius) {
    for (const k of ['chrome', 'control', 'card']) {
      if (!Number.isInteger(tokens.radius[k]) || tokens.radius[k] < 0) err('scales', `radius.${k} must be a non-negative integer`)
    }
  }
  if (tokens.type) {
    if (!(tokens.type.baseSizePx > 0)) err('scales', 'type.baseSizePx must be positive')
    if (!(tokens.type.baseLineHeight > 0)) err('scales', 'type.baseLineHeight must be positive')
    const mw = tokens.type.display?.maxWeight
    if (!Number.isInteger(mw) || mw < 100 || mw > 900) err('scales', 'type.display.maxWeight must be an integer 100–900')
    if (!(tokens.type.captionMinPx > 0)) err('scales', 'type.captionMinPx must be positive')
  }
  if (tokens.breakpoints && (!Array.isArray(tokens.breakpoints) || !tokens.breakpoints.every((n) => Number.isInteger(n) && n > 0))) {
    err('scales', 'breakpoints must be an array of positive integers')
  }
  if (tokens.contentWidths) {
    for (const [k, v] of Object.entries(tokens.contentWidths)) {
      if (!Number.isInteger(v) || v <= 0) err('scales', `contentWidths.${k} must be a positive integer`)
    }
  }

  return errors
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const tokensPath = process.argv[2] ?? DEFAULT_TOKENS
  const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'))
  const errors = validateTokens(tokens)
  if (errors.length > 0) {
    console.error(`[validate-tokens] FAILED — ${errors.length} rule violation(s) in ${tokensPath}:`)
    for (const e of errors) console.error('  ✗', e)
    process.exit(1)
  }
  console.log(`[validate-tokens] OK — ${tokensPath} satisfies shared/schemas/token-package.schema.json`)
}
