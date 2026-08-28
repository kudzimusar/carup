import {
  PASSPORT_AUDIENCES,
  PASSPORT_SCHEMA_VERSION,
  assertPassportAudience,
  assertPassportDataState,
  assertPublicSafeObject,
} from './passportContract.js';
import { buildPassportTimeline } from './passportTimelineService.js';

const PRIVILEGED_AUDIENCES = new Set([
  PASSPORT_AUDIENCES.OWNER,
  PASSPORT_AUDIENCES.SELLER,
  PASSPORT_AUDIENCES.GOVERNANCE,
]);

function clone(value) {
  if (value === null || value === undefined) return null;
  return structuredClone(value);
}

function pickProjection(section, audience) {
  if (!section) return null;

  if (audience === PASSPORT_AUDIENCES.PUBLIC) return clone(section.public);
  if (audience === PASSPORT_AUDIENCES.BUYER) return clone(section.buyer ?? section.public);
  if (audience === PASSPORT_AUDIENCES.GARAGE) return clone(section.garage ?? section.public);
  if (audience === PASSPORT_AUDIENCES.PARTNER) return clone(section.partner ?? section.public);
  if (audience === PASSPORT_AUDIENCES.GOVERNANCE) {
    return clone(section.governance ?? section.owner ?? section.privileged ?? section.public);
  }
  if (PRIVILEGED_AUDIENCES.has(audience)) {
    return clone(section.owner ?? section.privileged ?? section.public);
  }
  return clone(section.public);
}

function projectSection(section, audience, fallbackState = 'unknown') {
  const state = section?.state ?? fallbackState;
  assertPassportDataState(state);
  return {
    state,
    data: pickProjection(section, audience),
  };
}

function trustSection(trust, audience) {
  // Trust is deliberately pass-through. This service must never compute, band,
  // infer or repair a canonical Trust decision.
  return projectSection(trust, audience, trust ? 'known' : 'not_evaluated');
}

function timelineState(explicitState, events) {
  if (explicitState) return assertPassportDataState(explicitState);
  return events.length > 0 ? 'known' : 'unknown';
}

/**
 * Pure V1 Vehicle Passport composition.
 *
 * Integration callers are responsible for supplying projections from canonical
 * domain authorities. This assembler deliberately performs no database reads
 * and no Trust calculation, which keeps Passport an orchestration layer.
 */
export function assemblePassportReadModel(input, {
  audience = PASSPORT_AUDIENCES.PUBLIC,
  now = new Date().toISOString(),
} = {}) {
  assertPassportAudience(audience);
  if (!input?.vin || typeof input.vin !== 'string') {
    throw new Error('Vehicle Passport requires canonical VIN identity');
  }

  const timeline = buildPassportTimeline(input.timeline?.events || [], { audience });
  const model = {
    schema_version: PASSPORT_SCHEMA_VERSION,
    vin: input.vin,
    audience,
    generated_at: now,
    identity: projectSection(input.identity, audience),
    lifecycle: projectSection(input.lifecycle, audience),
    trust: trustSection(input.trust, audience),
    evidence: projectSection(input.evidence, audience),
    timeline: {
      state: timelineState(input.timeline?.state, timeline),
      events: timeline,
    },
    ownership: projectSection(input.ownership, audience),
    service: projectSection(input.service, audience),
    listing: projectSection(input.listing, audience),
    attention: projectSection(input.attention, audience, 'not_evaluated'),
    limitations: Array.isArray(input.limitations) ? [...input.limitations] : [],
  };

  if (audience === PASSPORT_AUDIENCES.PUBLIC || audience === PASSPORT_AUDIENCES.BUYER) {
    assertPublicSafeObject(model);
  }

  return model;
}

export default { assemblePassportReadModel };
