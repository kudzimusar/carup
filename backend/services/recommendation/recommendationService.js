import { supabase } from '../../db/supabase.js';
import { PUBLIC_VEHICLE_SELECT } from '../../utils/publicVehicleProjection.js';
import { publicVehicleStatusFilterValues, publiclyVisiblePublicationStatuses } from '../../utils/vehicleStatus.js';

// Served unauthenticated: candidates use the sanitized public projection and the
// same visibility rules as the marketplace — a draft or quarantined vehicle must
// never surface as a recommendation, and raw rows must never leave this service.
export async function getSmartRecommendations(vin, limit = 3) {
  const { data: referenceCar } = await supabase
    .from('vehicles')
    .select('vin, make, price')
    .eq('vin', vin)
    .single();
  if (!referenceCar) return [];

  const price = Number(referenceCar.price);
  const queries = [];

  const publicCandidates = () =>
    supabase
      .from('vehicles')
      .select(PUBLIC_VEHICLE_SELECT)
      .neq('vin', vin)
      .in('status', publicVehicleStatusFilterValues())
      .in('publication_status', publiclyVisiblePublicationStatuses())
      // Ordering by trust_score here selected WHICH vehicles a public shopper is shown, using the
      // unversioned legacy column no surface is allowed to publish — and since listings are now
      // created with a NULL score, Postgres NULLS FIRST made brand-new unscored listings the
      // PREFERRED candidates. Recency is an honest, non-trust selection basis; the route ranks the
      // survivors by canonical trust afterwards.
      .order('created_at', { ascending: false })
      .limit(limit);

  if (referenceCar.make) {
    queries.push(publicCandidates().eq('make', referenceCar.make));
  }

  if (Number.isFinite(price)) {
    queries.push(publicCandidates().gte('price', price * 0.7).lte('price', price * 1.3));
  }

  if (queries.length === 0) return [];

  const results = await Promise.all(queries);
  const firstError = results.find(result => result.error)?.error;
  if (firstError) throw firstError;

  const recommendationsByVin = new Map();
  for (const result of results) {
    for (const vehicle of (result.data || [])) {
      recommendationsByVin.set(vehicle.vin, vehicle);
    }
  }

  // No trust ordering here either: `|| 0` ranked an unscored vehicle as a zero, and the value it
  // read is the legacy column. The caller applies canonical trust ranking.
  return [...recommendationsByVin.values()].slice(0, limit);
}
