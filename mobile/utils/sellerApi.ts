import { apiUrl, resolveApiBaseUrl } from './apiBase';
import { fetchCsrfToken } from './verificationApi';
import { useAuthStore } from '../store/authStore';

export interface NativeSellerDraftInput {
  vin: string;
  make: string;
  model: string;
  year?: number | null;
  mileage: number;
  price: number;
  currency: 'USD' | 'ZiG';
  color?: string;
  location?: string;
  province?: string;
  description?: string;
}

export interface NativeSellerDraftReceipt {
  vin?: string;
  publication_status?: string;
  success?: boolean;
  [key: string]: unknown;
}

/**
 * CARUP-MVP-STAB-01 F-007 / F-008 — a public or closed listing is not edited from this app.
 * A PUBLISHED listing is changed only by the explicit published-listing save on the website, and a
 * SOLD one is read-only; the server refuses both with a coded 409. The app turns those refusals —
 * and a loaded vehicle already in either state — into a plain message and performs no write.
 */
export type SellerListingLock = 'published' | 'sold';

export const SELLER_LISTING_LOCK_MESSAGES: Record<SellerListingLock, string> = {
  published: 'This listing is public. Edit it from My Listings on the CarUp website.',
  sold: 'This listing is sold and closed.',
};

const LOCK_BY_REFUSAL_CODE: Record<string, SellerListingLock> = {
  SELLER_LISTING_PUBLISHED_EXPLICIT_SAVE_REQUIRED: 'published',
  SELLER_LISTING_PUBLISHED_USE_EXPLICIT_SAVE: 'published',
  SELLER_LISTING_SOLD_READ_ONLY: 'sold',
};

export class SellerListingLockedError extends Error {
  readonly lock: SellerListingLock;
  readonly code: string | null;

  constructor(lock: SellerListingLock, code: string | null) {
    super(SELLER_LISTING_LOCK_MESSAGES[lock]);
    this.name = 'SellerListingLockedError';
    this.lock = lock;
    this.code = code;
  }
}

/** Sold wins; then only `published` is public; anything else is an editable draft (null). */
export function sellerListingLockFor(
  vehicle?: { status?: string | null; publication_status?: string | null } | null,
): SellerListingLock | null {
  if (!vehicle) return null;
  if (String(vehicle.status ?? '').trim().toLowerCase() === 'sold') return 'sold';
  if (vehicle.publication_status === 'published') return 'published';
  return null;
}

function lockedRefusal(status: number, body: Record<string, unknown>): SellerListingLockedError | null {
  const code = typeof body?.code === 'string' ? body.code : null;
  if (code && LOCK_BY_REFUSAL_CODE[code]) return new SellerListingLockedError(LOCK_BY_REFUSAL_CODE[code], code);
  // A backend that predates the codes still states the lifecycle in its 409 body.
  const lock = status === 409
    ? sellerListingLockFor({
      status: typeof body?.status === 'string' ? body.status : null,
      publication_status: typeof body?.publication_status === 'string' ? body.publication_status : null,
    })
    : null;
  return lock ? new SellerListingLockedError(lock, null) : null;
}

async function mutationHeaders(): Promise<Record<string, string>> {
  const { token, user } = useAuthStore.getState();
  if (!token || !user) throw new Error('Sign in before starting a listing.');
  const csrfToken = await fetchCsrfToken(resolveApiBaseUrl(), token);
  return {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    'x-session-token': token,
    'x-user-id': user.id,
    'x-stakeholder-role': user.role,
    ...(user.active_tenant_id ? { 'x-tenant-id': user.active_tenant_id } : {}),
    'x-csrf-token': csrfToken,
  };
}

export async function createSellerDraft(input: NativeSellerDraftInput): Promise<NativeSellerDraftReceipt> {
  const response = await fetch(apiUrl('/api/vehicles/add'), {
    method: 'POST',
    headers: await mutationHeaders(),
    body: JSON.stringify({
      vin: input.vin.trim().toUpperCase(),
      make: input.make.trim(),
      model: input.model.trim(),
      ...(input.year ? { year: input.year } : {}),
      mileage: input.mileage,
      price: input.price,
      currency: input.currency,
      ...(input.color?.trim() ? { color: input.color.trim() } : {}),
      ...(input.location?.trim() ? { location: input.location.trim() } : {}),
      ...(input.province?.trim() ? { province: input.province.trim() } : {}),
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      location_visibility: 'withheld',
      public_seller_display_enabled: false,
      images: [],
    }),
  });

  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const locked = lockedRefusal(response.status, body);
    if (locked) throw locked;
    const message =
      typeof body?.error === 'string'
        ? body.error
        : 'CarUp could not save this listing draft.';
    throw new Error(message);
  }
  return body as NativeSellerDraftReceipt;
}


export interface NativeSellerDraftUpdate {
  description?: string;
  price?: number;
  currency?: 'USD' | 'ZiG';
  location?: string;
  province?: string;
  location_visibility?: 'withheld' | 'province_only' | 'public';
  public_seller_display_enabled?: boolean;
}

export async function updateSellerDraft(
  vin: string,
  input: NativeSellerDraftUpdate,
): Promise<NativeSellerDraftReceipt> {
  const response = await fetch(apiUrl(`/api/vehicles/${encodeURIComponent(vin)}/seller-draft`), {
    method: 'PATCH',
    headers: await mutationHeaders(),
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const locked = lockedRefusal(response.status, body);
    if (locked) throw locked;
    const message =
      typeof body?.error === 'string'
        ? body.error
        : 'CarUp could not update this listing draft.';
    throw new Error(message);
  }
  return body as NativeSellerDraftReceipt;
}
