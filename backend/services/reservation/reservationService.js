import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';

export async function reserveVehicle(vin, buyerId, durationDays = 7) {
  const { data: vehicle } = await supabase.from('vehicles').select('status, price, tenant_id').eq('vin', vin).single();
  if (!vehicle) throw new Error('Vehicle record not found');
  if (vehicle.status !== 'Available') throw new Error('Vehicle is not available for reservation');
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);
  
  // 1. Update vehicle state in database
  const { error } = await supabase.from('vehicles').update({ status: 'Reserved' }).eq('vin', vin);
  if (error) throw new Error(`Vehicle update failed: ${error.message}`);
  
  // 2. Emit Domain Event via Transactional Outbox Pattern
  await emitDomainEvent(null, 'VEHICLE_RESERVED', {
    vin,
    buyerId,
    durationDays,
    expiresAt: expiresAt.toISOString(),
    price: vehicle.price
  }, vehicle.tenant_id);

  return { vin, buyerId, reserved: true, expiresAt: expiresAt.toISOString() };
}
