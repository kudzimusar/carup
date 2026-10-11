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
    const message =
      typeof body?.error === 'string'
        ? body.error
        : 'CarUp could not save this listing draft.';
    throw new Error(message);
  }
  return body as NativeSellerDraftReceipt;
}
