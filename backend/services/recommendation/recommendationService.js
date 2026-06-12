import { supabase } from '../../db/supabase.js';

export async function getSmartRecommendations(vin, limit = 3) {
  const { data: referenceCar } = await supabase.from('vehicles').select('*').eq('vin', vin).single();
  if (!referenceCar) return [];

  const price = Number(referenceCar.price);
  const queries = [];

  if (referenceCar.make) {
    queries.push(
      supabase
        .from('vehicles')
        .select('*')
        .neq('vin', vin)
        .eq('make', referenceCar.make)
        .order('trust_score', { ascending: false })
        .limit(limit)
    );
  }

  if (Number.isFinite(price)) {
    queries.push(
      supabase
        .from('vehicles')
        .select('*')
        .neq('vin', vin)
        .gte('price', price * 0.7)
        .lte('price', price * 1.3)
        .order('trust_score', { ascending: false })
        .limit(limit)
    );
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

  return [...recommendationsByVin.values()]
    .sort((a, b) => (b.trust_score || 0) - (a.trust_score || 0))
    .slice(0, limit);
}
