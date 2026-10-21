import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The list card is a component module, so its Trust signal is checked by behaviour. Its React Native
// collaborators are replaced with inert stand-ins; nothing here renders.
vi.mock('react-native', () => ({ Pressable: () => null, Text: () => null, View: () => null }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../components/media/NativeMedia', () => ({ VehicleImage: () => null }));
vi.mock('../components/ui/NativePrimitives', () => ({ Price: () => null, StatusPill: () => null, TrustSignal: () => null }));
vi.mock('../theme/tokens', () => ({ radius: {}, spacing: {}, touchTarget: {}, typeScale: {}, useNativeTheme: () => ({}) }));
vi.mock('../utils/marketplaceApi', () => ({ resolveMarketplacePrimaryImage: () => null }));

import { vehicleCardTrustSignal } from '../components/marketplace/VehicleCard';

/**
 * CARUP-MVP-STAB-01 F-010 / F-011 / F-013 (Native) — wherever Native shows a Trust score it also says
 * how much that score can be relied on (confidence, evidence support, connected official sources),
 * the limitations are customer sentences rather than backend strings, and nothing is called
 * verified or evidence-backed that the Trust record does not establish.
 */

// The public Trust record staging served for Serena GFC27-027051 on 2026-10-21.
const SERENA = {
  vin: 'GFC27-027051',
  score: 60,
  band: 'moderate',
  evaluation_state: 'evaluated' as const,
  confidence: 'low',
  evidence_basis: {
    governed_facts_total: 7,
    governed_facts_substantiated: 0,
    governed_facts_adverse: 0,
    connected_sources: 0,
    unbacked_legacy_claims: 0,
  },
  calculation_version: 'trust-decision-1.1.0',
  evaluated_at: '2026-10-20T09:00:00.000Z',
  known_limitations: [
    'No live government/partner source is connected for this vehicle yet.',
    'Zimbabwe local registration is still in progress; this is a readiness limitation, not an adverse Trust finding.',
    'dealer compliance has not been evaluated for this vehicle.',
    'insurance eligibility has not been evaluated for this vehicle.',
    'finance eligibility has not been evaluated for this vehicle.',
    'escrow eligibility has not been evaluated for this vehicle.',
    'No governed vehicle fact is backed by an authoritative record.',
  ],
  source: 'cache',
};

function read(file: string): string {
  return readFileSync(resolve(__dirname, '..', file), 'utf8');
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, `marker not found: ${start}`).toBeGreaterThan(-1);
  expect(to, `marker not found after ${start}: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

const vehicle = read('app/vehicle/[vin].tsx');
const passport = read('app/vehicle/[vin]/passport.tsx');
const card = read('components/marketplace/VehicleCard.tsx');
const PRESENTER_IMPORT = /import\s*\{[^}]*\bpresentTrustForCustomer\b[^}]*\}\s*from\s*'@shared\/trust\/customerTrustPresentation'/;

describe('CARUP-MVP-STAB-01 · Native Vehicle Detail words Trust through the shared presenter', () => {
  const trustEvidence = between(vehicle, 'function TrustEvidence(', 'function FactRow(');

  it('the Trust card reads the record only through presentTrustForCustomer', () => {
    expect(vehicle).toMatch(PRESENTER_IMPORT);
    expect(trustEvidence).toMatch(/presentTrustForCustomer\(trust\)/);
    // Confidence, evidence support and connected official sources sit beside the score.
    expect(trustEvidence).toMatch(/\.rows\.map\(/);
    expect(trustEvidence).toMatch(/\.limitations\b/);
    // Backend limitation strings are never rendered as they arrive.
    expect(trustEvidence).not.toMatch(/known_limitations/);
    expect(trustEvidence).toContain('Known limitations');
  });

  it('every limitation stays reachable: three are shown, the rest behind an accessible "Show all"', () => {
    expect(trustEvidence).toMatch(/slice\(0,\s*3\)/);
    expect(trustEvidence).toMatch(/Show all \$\{[^}]+\}/);
    expect(trustEvidence).toMatch(/accessibilityLabel=\{[^}]*known limitations/);
  });

  it('no "evidence-backed" claim and no success check on the Trust card', () => {
    for (const [file, source] of [['[vin].tsx', vehicle], ['passport.tsx', passport], ['VehicleCard.tsx', card]]) {
      expect(source, file).not.toMatch(/evidence[- ]backed/i);
    }
    expect(trustEvidence).not.toMatch(/tone=["']success["']/);
  });

  it('only the public badge wording is shown, never raw trust_badges slugs', () => {
    expect(vehicle).not.toMatch(/trust_badges/);
    expect(vehicle).toMatch(/public_badge_copy/);
  });

  it('Evidence status is the backend value in plain words, and "Verified" only when the backend says verified', () => {
    const mapping = between(vehicle, 'const EVIDENCE_STATUS_LABEL', '};');
    const entries = Object.fromEntries(
      [...mapping.matchAll(/^\s*([a-z_]+):\s*'([^']*)'/gm)].map((match) => [match[1], match[2]]),
    );
    expect(entries).toEqual({
      none: 'None',
      partial: 'Partial',
      available: 'Available',
      verified: 'Verified',
      review_required: 'Under review',
      unavailable: 'Could not be checked',
    });
    expect(Object.entries(entries).filter(([, label]) => /verified/i.test(label))).toEqual([['verified', 'Verified']]);
    expect(vehicle).toMatch(/label="Evidence status" value=\{evidenceStatusLabel\(trustSummary\?\.evidence_status\)\}/);
    expect(vehicle).not.toMatch(/titleCase\(trustSummary\?\.evidence_status\)/);
  });
});

describe('CARUP-MVP-STAB-01 · Native Passport states confidence and limitations beside the score', () => {
  const trustSection = between(passport, 'title="Trust assessment"', 'title="Passport evidence"');

  it('the Trust assessment section shows the presenter rows and customer limitations', () => {
    expect(passport).toMatch(PRESENTER_IMPORT);
    expect(passport).toMatch(/presentTrustForCustomer\(/);
    expect(trustSection).toContain('label="Score"');
    expect(trustSection).toMatch(/\.rows\.map\(/);
    expect(trustSection).toMatch(/\.limitations\b/);
    expect(trustSection).toContain('Known limitations');
    expect(passport).not.toMatch(/known_limitations/);
  });
});

describe('CARUP-MVP-STAB-01 · the list card never celebrates a Trust evaluation', () => {
  it('labels an evaluated record with its confidence, in a neutral tone', () => {
    expect(vehicleCardTrustSignal({ trust: SERENA, evidence_count: 0 })).toEqual({
      label: 'Trust evaluated · Confidence low',
      detail: 'Moderate · 0 of 7 vehicle facts independently confirmed',
      tone: 'neutral',
    });
  });

  it('is neutral for every band, including low and insufficient evidence', () => {
    for (const band of ['high', 'moderate', 'low', 'insufficient_evidence']) {
      const signal = vehicleCardTrustSignal({ trust: { ...SERENA, band, confidence: 'high' }, evidence_count: 0 });
      expect(signal?.tone, band).toBe('neutral');
      expect(signal?.label, band).not.toMatch(/verified|available/i);
    }
    expect(vehicleCardTrustSignal({ trust: { ...SERENA, band: 'insufficient_evidence' }, evidence_count: 0 })?.detail)
      .toBe('Insufficient evidence · 0 of 7 vehicle facts independently confirmed');
    expect(card).not.toMatch(/tone=["']success["']|tone:\s*'success'/);
    expect(card).not.toContain('CarUp Trust evaluation available');
  });

  it('a record without a usable score is never called evaluated', () => {
    for (const trust of [
      { ...SERENA, evaluation_state: 'stale' as const },
      { ...SERENA, evaluation_state: 'not_evaluated' as const, score: null },
      { ...SERENA, score: Number.NaN },
      null,
    ]) {
      expect(vehicleCardTrustSignal({ trust, evidence_count: 0 })).toBeNull();
    }
    expect(vehicleCardTrustSignal({ trust: null, evidence_count: 2 })).toEqual({
      label: 'Vehicle evidence available',
      detail: '2 evidence records',
      tone: 'neutral',
    });
  });

  it('missing evidence support is not presented as a count', () => {
    const signal = vehicleCardTrustSignal({ trust: { ...SERENA, evidence_basis: null, confidence: null }, evidence_count: 0 });
    expect(signal).toEqual({ label: 'Trust evaluated · Confidence not recorded', detail: 'Moderate', tone: 'neutral' });
  });

  it('the card reads Trust through the shared presenter', () => {
    expect(card).toMatch(PRESENTER_IMPORT);
  });
});
