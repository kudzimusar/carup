/**
 * CARUP-MVP-STAB-01 F-007 / F-008 — the native Sell screen never edits a public or closed listing.
 *
 * `sell/details.tsx` resumes a listing through the same seller-draft PATCH as the web Studio. On a
 * PUBLISHED listing that PATCH is now refused with a structured 409 (the explicit published-listing
 * save lives on the website), and a SOLD listing is read-only. The native screen must say so in
 * plain words and write nothing — not surface "Only an unpublished active Seller draft can be
 * autosaved" as if the seller had made a mistake.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const secureStore = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => secureStore.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secureStore.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secureStore.delete(k)),
}));

process.env.EXPO_PUBLIC_API_URL = 'https://staging.example.test';

const { useAuthStore } = await import('../store/authStore');
const {
  SELLER_LISTING_LOCK_MESSAGES,
  SellerListingLockedError,
  createSellerDraft,
  nativeResumeDraftUpdate,
  sellerListingLockFor,
  updateSellerDraft,
} = await import('../utils/sellerApi');

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const writes: string[] = [];
const sentBodies: Record<string, unknown>[] = [];
function stubBackend(sellerResponse: Response) {
  writes.length = 0;
  sentBodies.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/security/csrf-token')) return json(200, { csrfToken: 'csrf-1' });
    writes.push(`${init?.method || 'GET'} ${String(url).replace('https://staging.example.test', '')}`);
    if (typeof init?.body === 'string') sentBodies.push(JSON.parse(init.body));
    return sellerResponse;
  }));
}

describe('the resume save never resets the seller\'s privacy choices', () => {
  it('sends no privacy field when the seller did not type a location', () => {
    const update = nativeResumeDraftUpdate({ price: 12800, currency: 'USD', location: '', description: '', storedLocationVisibility: 'public' });
    expect(update).toEqual({ price: 12800, currency: 'USD' });
    expect(update).not.toHaveProperty('location_visibility');
    expect(update).not.toHaveProperty('public_seller_display_enabled');
  });

  it('carries the seller\'s STORED visibility with a newly typed location — never a default', () => {
    expect(nativeResumeDraftUpdate({ price: 12800, currency: 'USD', location: ' Harare ', storedLocationVisibility: 'public' }))
      .toEqual({ price: 12800, currency: 'USD', location: 'Harare', location_visibility: 'public' });
    expect(nativeResumeDraftUpdate({ price: 12800, currency: 'USD', location: 'Harare', storedLocationVisibility: 'province_only' }).location_visibility)
      .toBe('province_only');
    // An unknown stored choice is not guessed at.
    for (const stored of [undefined, null, '', 'everyone']) {
      expect(nativeResumeDraftUpdate({ price: 12800, currency: 'USD', location: 'Harare', storedLocationVisibility: stored }))
        .toEqual({ price: 12800, currency: 'USD', location: 'Harare' });
    }
  });

  it('never sends the public seller name choice, whatever was typed', () => {
    const update = nativeResumeDraftUpdate({ price: 12800, currency: 'ZiG', location: 'Harare', description: ' Clean car. ', storedLocationVisibility: 'withheld' });
    expect(update).toEqual({ price: 12800, currency: 'ZiG', location: 'Harare', location_visibility: 'withheld', description: 'Clean car.' });
    expect(update).not.toHaveProperty('public_seller_display_enabled');
  });

  it('what reaches the server on a resume save holds no privacy defaults', async () => {
    stubBackend(json(200, { success: true, vin: 'GFC27-027051', publication_status: 'publishable' }));
    await updateSellerDraft('GFC27-027051', nativeResumeDraftUpdate({ price: 12800, currency: 'USD', location: '', description: '' }));
    expect(sentBodies).toEqual([{ price: 12800, currency: 'USD' }]);
  });

  it('sell/details.tsx builds its resume save with the helper and no literal privacy defaults', () => {
    const screen = readFileSync(resolve(__dirname, '../app/sell/details.tsx'), 'utf8');
    expect(screen).toContain('nativeResumeDraftUpdate({');
    expect(screen).toContain('storedLocationVisibility: (ownedVehicle as { listing_location_visibility?: unknown } | null)?.listing_location_visibility');
    expect(screen).not.toContain("location_visibility: 'withheld'");
    expect(screen).not.toContain('public_seller_display_enabled: false');
  });
});

beforeEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({
    token: 'tok-1',
    user: { id: 'u-owner', name: 'Farai', email: 'f@example.invalid', role: 'owner' } as never,
  });
});

describe('sellerListingLockFor — read from the loaded vehicle', () => {
  it('a sold vehicle is closed, whatever its publication state (case-insensitive)', () => {
    expect(sellerListingLockFor({ status: 'Sold', publication_status: 'published' })).toBe('sold');
    expect(sellerListingLockFor({ status: 'sold', publication_status: 'draft' })).toBe('sold');
  });

  it('a published listing is public; every other state is an editable draft', () => {
    expect(sellerListingLockFor({ status: 'Available', publication_status: 'published' })).toBe('published');
    for (const publication of ['draft', 'identity_complete', 'documents_submitted', 'review_pending', 'publishable', null, undefined]) {
      expect(sellerListingLockFor({ status: 'Available', publication_status: publication })).toBeNull();
    }
    expect(sellerListingLockFor(null)).toBeNull();
  });

  it('says it plainly', () => {
    expect(SELLER_LISTING_LOCK_MESSAGES.published).toBe('This listing is public. Edit it from My Listings on the CarUp website.');
    expect(SELLER_LISTING_LOCK_MESSAGES.sold).toBe('This listing is sold and closed.');
  });
});

describe('the seller API turns the structured refusals into a lock, not an error message', () => {
  const update = () => updateSellerDraft('GFC27-027051', { price: 12800, currency: 'USD', location_visibility: 'withheld' });

  it('a published listing refusal is the "public" lock', async () => {
    stubBackend(json(409, { error: 'Only an unpublished active Seller draft can be autosaved', code: 'SELLER_LISTING_PUBLISHED_EXPLICIT_SAVE_REQUIRED', publication_status: 'published' }));
    const failure = await update().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SellerListingLockedError);
    expect((failure as InstanceType<typeof SellerListingLockedError>).lock).toBe('published');
    expect((failure as Error).message).toBe(SELLER_LISTING_LOCK_MESSAGES.published);
  });

  it('a sold listing refusal is the "closed" lock', async () => {
    stubBackend(json(409, { error: 'Only an unpublished active Seller draft can be autosaved', code: 'SELLER_LISTING_SOLD_READ_ONLY', status: 'Sold' }));
    const failure = await update().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SellerListingLockedError);
    expect((failure as InstanceType<typeof SellerListingLockedError>).lock).toBe('sold');
    expect((failure as Error).message).toBe(SELLER_LISTING_LOCK_MESSAGES.sold);
  });

  it('an older backend\'s uncoded 409 is read for what it says', async () => {
    stubBackend(json(409, { error: 'Only an unpublished active Seller draft can be autosaved', publication_status: 'published', status: 'Available' }));
    expect(((await update().catch((error: unknown) => error)) as InstanceType<typeof SellerListingLockedError>).lock).toBe('published');
  });

  it('the re-save of a published listing through /api/vehicles/add is the "public" lock too', async () => {
    stubBackend(json(409, { error: 'This listing is live on the CarUp Marketplace…', code: 'SELLER_LISTING_PUBLISHED_USE_EXPLICIT_SAVE', publication_status: 'published' }));
    const failure = await createSellerDraft({ vin: 'GFC27-027051', make: 'Nissan', model: 'Serena', mileage: 63000, price: 12800, currency: 'USD' })
      .catch((error: unknown) => error);
    expect((failure as InstanceType<typeof SellerListingLockedError>).lock).toBe('published');
  });

  it('every other failure keeps its own message, and a draft save still succeeds', async () => {
    stubBackend(json(500, { error: 'boom' }));
    const failure = await update().catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(SellerListingLockedError);
    expect((failure as Error).message).toBe('boom');

    stubBackend(json(200, { success: true, vin: 'GFC27-027051', publication_status: 'publishable' }));
    await expect(update()).resolves.toMatchObject({ success: true });
    expect(writes).toEqual(['PATCH /api/vehicles/GFC27-027051/seller-draft']);
  });
});

describe('sell/details.tsx performs no write for a public or closed listing', () => {
  const screen = readFileSync(resolve(__dirname, '../app/sell/details.tsx'), 'utf8');

  it('derives the lock from the loaded vehicle and from a refusal, and renders the plain message', () => {
    expect(screen).toContain('sellerListingLockFor(ownedVehicle)');
    expect(screen).toContain('cause instanceof SellerListingLockedError');
    expect(screen).toContain('SELLER_LISTING_LOCK_MESSAGES[listingLock]');
  });

  it('returns from save() before any write when the listing is locked', () => {
    const save = screen.indexOf('const save = async () => {');
    const guard = screen.indexOf('if (listingLock) return', save);
    const firstWrite = Math.min(
      ...['await updateSellerDraft(', 'await createSellerDraft('].map((call) => screen.indexOf(call, save)).filter((i) => i > -1),
    );
    expect(save).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(save);
    expect(guard).toBeLessThan(firstWrite);
  });
});
