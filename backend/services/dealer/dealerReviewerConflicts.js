/**
 * CARUP-DEALER-ONB-001-LR01-R6 closure — a reviewer's conflicts of interest for READS.
 *
 * The data layer already refuses a conflicted reviewer's DECISIONS (20261103145000 / 146000:
 * own claim on the business, membership of the dealership's tenant). This module applies the
 * same rule to what a reviewer may SEE: a reviewer who claims a business, or who works for a
 * dealership linked to it, never receives that business's private evidence, signed document
 * links, frozen application snapshot, lifecycle reasons or queue entries.
 */
import { supabase } from '../../db/supabase.js';

const refuse = (code, status) => Object.assign(new Error(code), { statusCode: status, code });
const ids = (rows, key) => new Set((Array.isArray(rows) ? rows : [])
  .map((r) => r?.[key]).filter((v) => typeof v === 'string' && v.length > 0));

/** Every research seed the reviewer is conflicted on (claims held + dealerships they belong to). */
export async function loadReviewerConflicts(actor, { db = supabase } = {}) {
  const [claims, members] = await Promise.all([
    db.from('dealer_research_claim_requests').select('seed_dealer_id')
      .eq('claimant_user_id', actor.userId).limit(500),
    db.from('tenant_users').select('tenant_id').eq('user_id', actor.userId).limit(500),
  ]);
  if (claims.error || members.error) throw refuse('REVIEWER_CONFLICT_LOOKUP_UNAVAILABLE', 503);
  const tenants = ids(members.data, 'tenant_id');
  let linkedSeeds = new Set();
  let attachedSeeds = new Set();
  if (tenants.size) {
    // UAT-R1: a research seed ATTACHED to a dealership (second branch claim of the same company)
    // conflicts that dealership's members exactly like its primary seed does.
    const [links, attachments] = await Promise.all([
      db.from('dealer_approved_seed_links').select('seed_dealer_id').in('tenant_id', [...tenants]).limit(500),
      db.from('dealer_branch_claim_attachments').select('seed_dealer_id').in('tenant_id', [...tenants]).limit(500),
    ]);
    if (links.error || attachments.error) throw refuse('REVIEWER_CONFLICT_LOOKUP_UNAVAILABLE', 503);
    linkedSeeds = ids(links.data, 'seed_dealer_id');
    attachedSeeds = ids(attachments.data, 'seed_dealer_id');
  }
  const seeds = new Set([...ids(claims.data, 'seed_dealer_id'), ...linkedSeeds, ...attachedSeeds]);
  return Object.freeze({
    seeds, tenants,
    conflicted: (seedId) => typeof seedId === 'string' && seeds.has(seedId),
  });
}

/** 403 DEALER_REVIEWER_CONFLICT_OF_INTEREST before any private read (and before any step-up attempt). */
export async function assertReviewerNotConflicted(actor, seedId, opts) {
  const conflicts = await loadReviewerConflicts(actor, opts);
  if (conflicts.conflicted(seedId)) throw refuse('DEALER_REVIEWER_CONFLICT_OF_INTEREST', 403);
  return conflicts;
}
