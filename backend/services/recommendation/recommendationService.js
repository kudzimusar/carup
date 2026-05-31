import { supabase } from '../../db/supabase.js';

export async function getSmartRecommendations(vin, limit = 3) {
  const { data: referenceCar } = await supabase.from('vehicles').select('*').eq('vin', vin).single();
  if (!referenceCar) return [];
  
  const { data: recommendations } = await supabase
    .from('vehicles')
    .select('*')
    .neq('vin', vin)
    .or(`make.eq.${referenceCar.make},and(price.gte.${referenceCar.price * 0.7},price.lte.${referenceCar.price * 1.3})`)
    .order('trust_score', { ascending: false })
    .limit(limit);

  return recommendations || [];
}
