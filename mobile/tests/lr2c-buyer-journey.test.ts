import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getCanonicalOwnershipProof,
  OWNERSHIP_TRANSFER_DISCOVERY_DEPENDENCY,
  resolveExistingVehicleConversation,
  selectLatestCanonicalBuyerTransaction,
  type BuyerTransactionSession,
} from '../utils/buyerJourneyApi';

function session(overrides: Partial<BuyerTransactionSession> = {}): BuyerTransactionSession {
  return {
    transaction_intent_id: 'tx-1',
    vin: 'VIN-001',
    status: 'eligible',
    listing_amount: 10000,
    listing_currency: 'USD',
    gate_reasons: [],
    payment_state: 'not_started',
    reservation_state: 'active',
    deposit_eligibility: null,
    created_at: '2026-10-16T00:00:00Z',
    updated_at: '2026-10-16T00:00:00Z',
    ...overrides,
  };
}

describe('LR2-C canonical VIN and transaction authority', () => {
  it('selects only transactions bound to the exact requested VIN', () => {
    const result = selectLatestCanonicalBuyerTransaction('VIN-001', [
      session({ transaction_intent_id: 'tx-other', vin: 'VIN-OTHER', updated_at: '2026-10-16T03:00:00Z' }),
      session({ transaction_intent_id: 'tx-old', updated_at: '2026-10-16T01:00:00Z' }),
      session({ transaction_intent_id: 'tx-new', updated_at: '2026-10-16T02:00:00Z' }),
    ]);
    expect(result?.transaction_intent_id).toBe('tx-new');
    expect(result?.vin).toBe('VIN-001');
  });

  it('does not manufacture a transaction when the participant projection has no exact VIN', () => {
    expect(selectLatestCanonicalBuyerTransaction('VIN-MISSING', [
      session({ vin: 'VIN-001' }),
    ])).toBeNull();
  });
});

describe('LR2-C canonical ownership proof', () => {
  it('requires owner_id equality and does not treat a seller relationship as ownership', async () => {
    const proof = await getCanonicalOwnershipProof('VIN-001', 'buyer-1', async () => [{
      vin: 'VIN-001',
      owner_id: 'owner-other',
      current_seller_id: 'buyer-1',
      make: 'Toyota',
      model: 'Hilux',
      year: 2024,
    }]);
    expect(proof).toEqual({ state: 'not_owned', vin: 'VIN-001' });
  });

  it('proves ownership only for the exact VIN and authenticated owner id', async () => {
    const proof = await getCanonicalOwnershipProof('VIN-001', 'buyer-1', async () => [{
      vin: 'VIN-001',
      owner_id: 'buyer-1',
      current_seller_id: null,
      make: 'Toyota',
      model: 'Hilux',
      year: 2024,
    }]);
    expect(proof.state).toBe('owned');
    if (proof.state === 'owned') {
      expect(proof.vehicle.vin).toBe('VIN-001');
      expect(proof.vehicle.owner_id).toBe('buyer-1');
    }
  });

  it('keeps Account A owned Vehicle out of Account B ownership proof', async () => {
    const accountB = await getCanonicalOwnershipProof('VIN-001', 'account-b', async () => [{
      vin: 'VIN-001',
      owner_id: 'account-a',
      make: 'Toyota',
      model: 'Hilux',
      year: 2024,
    }]);
    expect(accountB).toEqual({ state: 'not_owned', vin: 'VIN-001' });
  });

  it('fails truthfully when the canonical Garage projection cannot be read', async () => {
    const proof = await getCanonicalOwnershipProof('VIN-001', 'buyer-1', async () => {
      throw new Error('Could not load your vehicles.');
    });
    expect(proof).toEqual({
      state: 'unavailable',
      vin: 'VIN-001',
      reason: 'Could not load your vehicles.',
    });
  });
});

describe('LR2-C conversation continuity', () => {
  it('reuses the single participant-authorized Marketplace inquiry conversation for the VIN', async () => {
    const listThreads = vi.fn(async () => ({
      threads: [
        { id: 'thread-other', subject_type: 'marketplace_inquiry', marketplace_listing_id: 'VIN-OTHER' },
        { id: 'thread-1', subject_type: 'marketplace_inquiry', marketplace_listing_id: 'VIN-001' },
      ],
    }));
    const result = await resolveExistingVehicleConversation('VIN-001', listThreads);
    expect(result.state).toBe('resolved');
    if (result.state === 'resolved') expect(result.thread.id).toBe('thread-1');
    expect(listThreads).toHaveBeenCalledTimes(1);
  });

  it('fails closed rather than guessing among multiple historical inquiry threads', async () => {
    const result = await resolveExistingVehicleConversation('VIN-001', async () => ({
      threads: [
        { id: 'thread-1', subject_type: 'marketplace_inquiry', marketplace_listing_id: 'VIN-001' },
        { id: 'thread-2', subject_type: 'marketplace_inquiry', marketplace_listing_id: 'VIN-001' },
      ],
    }));
    expect(result).toEqual({ state: 'ambiguous', vin: 'VIN-001', count: 2 });
  });

  it('does not substitute another conversation when none matches the VIN', async () => {
    const result = await resolveExistingVehicleConversation('VIN-001', async () => ({
      threads: [{ id: 'thread-other', subject_type: 'account', marketplace_listing_id: 'VIN-001' }],
    }));
    expect(result).toEqual({ state: 'unavailable', vin: 'VIN-001' });
  });
});

describe('LR2-C source integration and authority boundaries', () => {
  const buyerApi = readFileSync(resolve('utils/buyerJourneyApi.ts'), 'utf8');
  const vehicle = readFileSync(resolve('app/vehicle/[vin].tsx'), 'utf8');
  const passport = readFileSync(resolve('app/vehicle/[vin]/passport.tsx'), 'utf8');
  const transaction = readFileSync(resolve('app/vehicle/[vin]/transaction.tsx'), 'utf8');
  const garageApi = readFileSync(resolve('utils/ownerGarageApi.ts'), 'utf8');

  it('connects the same Vehicle VIN to Passport and transaction routes', () => {
    expect(vehicle).toContain('/passport');
    expect(vehicle).toContain('/transaction');
    expect(vehicle).toContain('encodeURIComponent(vehicle.vin)');
    expect(passport).toContain('getBuyerVehiclePassport(canonicalVin)');
    expect(transaction).toContain('getBuyerTransactionsForVin(canonicalVin)');
  });

  it('consumes canonical reservation and transaction endpoints without a Native state writer', () => {
    expect(buyerApi).toContain('/api/vehicles/${encodeURIComponent(vin)}/reserve');
    expect(buyerApi).toContain('/api/vehicles/${encodeURIComponent(vin)}/escrow');
    expect(buyerApi).toContain('/api/escrow/${encodeURIComponent(transactionIntentId)}/initiate');
    expect(buyerApi).toContain('/api/escrow/${encodeURIComponent(transactionIntentId)}/deposit/eligibility');
    expect(buyerApi).toContain('/api/escrow/${encodeURIComponent(transactionIntentId)}/payment-intent');

    expect(buyerApi).not.toContain('/sandbox/capture');
    expect(buyerApi).not.toContain('/inspection/start');
    expect(buyerApi).not.toContain('/release/approve');
    expect(buyerApi).not.toContain('/api/safepay/');
    expect(buyerApi).not.toContain('/transition');
  });

  it('never calls ownership-transfer writes or invents a transaction-to-transfer mapping', () => {
    expect(buyerApi).not.toContain('/ownership-transfers');
    expect(transaction).not.toContain('/ownership-transfers');
    expect(OWNERSHIP_TRANSFER_DISCOVERY_DEPENDENCY).toMatch(/transferId/i);
  });

  it('renders Passport evidence from the canonical evidenceVault and truthful missing state', () => {
    expect(passport).toContain('passport.evidenceVault');
    expect(passport).toContain('No evidence returned');
    expect(passport).toContain('does not insert demo documents');
    expect(passport).not.toContain('mockEvidence');
    expect(passport).not.toContain('demoEvidence');
  });

  it('requires the Garage owner_id authority rather than list membership alone', () => {
    expect(garageApi).toContain('owner_id?: string | null');
    expect(buyerApi).toContain("String(matching.owner_id || '') !== expectedOwner");
    expect(transaction).toContain("ownership?.state === 'owned'");
  });

  it('keeps SafePay provider and governance states out of Native authority', () => {
    expect(transaction).toContain('never decides funds held, inspection approval, release approval, settlement or refund');
    expect(transaction).not.toContain("status: 'funds_held'");
    expect(transaction).not.toContain("status: 'settled'");
    expect(transaction).not.toContain("status: 'release_approved'");
  });

  it('preserves existing conversation authority and never creates a transaction-specific thread', () => {
    expect(buyerApi).toContain('listCommunicationThreads');
    expect(buyerApi).not.toContain('createCommunicationThread');
    expect(transaction).toContain('resolveExistingVehicleConversation(canonicalVin)');
    expect(transaction).toContain("type: 'conversation'");
  });

  it('scopes protected Passport, transaction and ownership queries to account/tenant/role', () => {
    expect(passport).toContain("user?.id || 'anonymous'");
    expect(passport).toContain("user?.active_tenant_id || 'none'");
    expect(passport).toContain("user?.role || 'none'");
    expect(transaction).toContain("user?.id || 'anonymous'");
    expect(transaction).toContain("user?.active_tenant_id || 'none'");
    expect(transaction).toContain("user?.role || 'none'");
  });
});
