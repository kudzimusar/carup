import type { OwnerServiceHistoryEntry } from '@shared/types';
import { apiUrl } from './apiBase';
import { useAuthStore } from '../store/authStore';
import { nativeNow, recordNetworkResponse } from './nativePerformance';

export interface NativeOwnedVehicle {
  vin: string;
  make: string;
  model: string;
  year: number | null;
  color?: string | null;
  mileage?: number | null;
  fuel_type?: string | null;
  transmission?: string | null;
  status?: string | null;
  trust_score?: number | null;
  price?: number | null;
  currency?: string | null;
}

async function ownerHeaders(): Promise<Record<string, string>> {
  const { token, user } = useAuthStore.getState();
  return {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...(token ? { 'x-session-token': token } : {}),
    ...(user?.role ? { 'x-stakeholder-role': user.role } : {}),
    ...(user?.active_tenant_id ? { 'x-tenant-id': user.active_tenant_id } : {}),
  };
}

export async function getMyVehicles(): Promise<NativeOwnedVehicle[]> {
  const startedAt = nativeNow();
  const response = await fetch(apiUrl('/api/vehicles/me'), {
    headers: await ownerHeaders(),
  });
  recordNetworkResponse('api.owner_vehicles', startedAt, response);
  if (!response.ok) throw new Error('Could not load your vehicles.');
  const body = await response.json();
  return Array.isArray(body) ? body : [];
}


export async function getMyServiceHistory(): Promise<OwnerServiceHistoryEntry[]> {
  const startedAt = nativeNow();
  const response = await fetch(apiUrl('/api/service-history/me'), {
    headers: await ownerHeaders(),
  });
  recordNetworkResponse('api.owner_service_history', startedAt, response);
  if (!response.ok) throw new Error('Could not load your service history.');
  const body = await response.json();
  return Array.isArray(body) ? body : [];
}
