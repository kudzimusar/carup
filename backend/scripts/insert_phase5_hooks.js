import fs from 'fs';

const hookFile = 'src/hooks/useCarUpApi.ts';
let content = fs.readFileSync(hookFile, 'utf8');

const insertion = `
  // ==========================================
  // PHASE 5: OWNER & ADMIN OS HOOKS
  // ==========================================

  const fetchOwnedVehicles = useCallback(async () => {
    return fetchApi('/vehicles/me', { method: 'GET' })
  }, [fetchApi])

  const fetchSavedVehicles = useCallback(async () => {
    return fetchApi('/vehicles/saved', { method: 'GET' })
  }, [fetchApi])

  const saveVehicle = useCallback(async (vin: string) => {
    return fetchApi('/vehicles/saved/add', { method: 'POST', body: JSON.stringify({ vin }) })
  }, [fetchApi])

  const fetchServiceHistory = useCallback(async () => {
    return fetchApi('/service-history/me', { method: 'GET' })
  }, [fetchApi])

  const fetchNotifications = useCallback(async () => {
    return fetchApi('/notifications/me', { method: 'GET' })
  }, [fetchApi])

  const fetchAdminUsers = useCallback(async () => {
    return fetchApi('/users/management', { method: 'GET' })
  }, [fetchApi])

  const fetchAdminTelemetry = useCallback(async () => {
    return fetchApi('/telemetry', { method: 'GET' })
  }, [fetchApi])

  const suspendUser = useCallback(async (id: string) => {
    return fetchApi(\`/users/\${id}/suspend\`, { method: 'POST' })
  }, [fetchApi])

`;

if (!content.includes('fetchOwnedVehicles')) {
  content = content.replace('return {', insertion + '\n  return {');
  
  // also add them to the return statement
  const returnExports = `
    fetchOwnedVehicles,
    fetchSavedVehicles,
    saveVehicle,
    fetchServiceHistory,
    fetchNotifications,
    fetchAdminUsers,
    fetchAdminTelemetry,
    suspendUser,
  `;
  content = content.replace('return {', 'return {' + returnExports);
  fs.writeFileSync(hookFile, content, 'utf8');
  console.log('Hooks inserted successfully.');
} else {
  console.log('Hooks already exist.');
}
