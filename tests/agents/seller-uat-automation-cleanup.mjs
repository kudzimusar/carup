import { request as playwrightRequest } from '@playwright/test';

const API_URL = String(process.env.STAGING_API_URL || '').replace(/\/$/, '');
const SELLER_EMAIL = 'uat.buyer@carup-staging.test';
const PASSWORD = process.env.STAGING_UAT_BUYER_PASSWORD || '';

if (!API_URL) throw new Error('STAGING_API_URL is required');
if (!PASSWORD) throw new Error('STAGING_UAT_BUYER_PASSWORD is required');

const context = await playwrightRequest.newContext({ baseURL: API_URL });

async function login() {
  const csrfResponse = await context.get('/security/csrf-token');
  if (!csrfResponse.ok()) throw new Error(`guest CSRF failed: ${csrfResponse.status()}`);
  const { csrfToken } = await csrfResponse.json();
  const response = await context.post('/auth/login', {
    headers: { 'x-csrf-token': csrfToken },
    data: { email: SELLER_EMAIL, password: PASSWORD },
  });
  if (!response.ok()) throw new Error(`staging Seller login failed: ${response.status()} ${await response.text()}`);
  return response.json();
}

function isAutomationVehicle(vehicle) {
  const description = String(vehicle?.seller_description || vehicle?.description || '');
  return description.includes('UAT_AUTOMATION[') || description.includes('Golden Dynamic Seller seller-');
}

const { token, user } = await login();
const baseHeaders = {
  'x-session-token': token,
  'x-user-id': user.id,
  'x-stakeholder-role': user.role,
};

const vehiclesResponse = await context.get('/vehicles/me', { headers: baseHeaders });
if (!vehiclesResponse.ok()) {
  throw new Error(`owned vehicles read failed: ${vehiclesResponse.status()} ${await vehiclesResponse.text()}`);
}
const vehicles = await vehiclesResponse.json();
const targets = (Array.isArray(vehicles) ? vehicles : []).filter(isAutomationVehicle);

for (const vehicle of targets) {
  const csrfResponse = await context.get('/security/csrf-token', { headers: baseHeaders });
  if (!csrfResponse.ok()) throw new Error(`CSRF failed for ${vehicle.vin}: ${csrfResponse.status()}`);
  const { csrfToken } = await csrfResponse.json();
  const headers = { ...baseHeaders, 'x-csrf-token': csrfToken };

  if (String(vehicle.publication_status || '').toLowerCase() === 'published') {
    const unpublish = await context.post(`/vehicles/${encodeURIComponent(vehicle.vin)}/unpublish`, { headers, data: {} });
    if (!unpublish.ok()) {
      throw new Error(`unpublish failed for ${vehicle.vin}: ${unpublish.status()} ${await unpublish.text()}`);
    }
  }

  const sold = await context.patch(`/vehicles/${encodeURIComponent(vehicle.vin)}/status`, {
    headers,
    data: { status: 'sold' },
  });
  if (!sold.ok()) {
    throw new Error(`mark sold failed for ${vehicle.vin}: ${sold.status()} ${await sold.text()}`);
  }

  process.stdout.write(`retired automation vehicle ${vehicle.vin}\n`);
}

process.stdout.write(`seller automation cleanup complete: ${targets.length} vehicle(s) retired\n`);
await context.dispose();
