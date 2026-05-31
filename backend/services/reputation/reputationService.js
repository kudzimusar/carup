import { supabase } from '../../db/supabase.js';

export async function calculateDealerReputation(dealerId) {
  const { data: profile } = await supabase.from('stakeholder_profiles').select('*').eq('user_id', dealerId).single();
  if (!profile) return { error: 'Dealer profile not found' };
  
  const { data: escrows } = await supabase.from('safepay_escrows').select('status').eq('seller_id', dealerId);
  
  const total = escrows?.length || 0;
  const completed = escrows?.filter(e => e.status === 'Completed').length || 0;
  const disputed = escrows?.filter(e => e.status === 'Disputed').length || 0;
  
  let baseReputation = 75.0;
  if (total > 0) {
    const successRatio = completed / total;
    const completedBonus = completed * 2.0;
    const disputePenalty = disputed * 10.0;
    baseReputation += (successRatio * 15.0) + completedBonus - disputePenalty;
  }

  const finalScore = parseFloat(Math.min(100.0, Math.max(10.0, baseReputation)).toFixed(1));
  
  await supabase.from('stakeholder_profiles').update({ trust_score: finalScore }).eq('user_id', dealerId);

  return { dealerId, reputationScore: finalScore, stats: { totalEscrows: total, completedEscrows: completed, disputedEscrows: disputed, verificationTier: finalScore >= 90.0 ? 'Diamond Certified Dealer' : 'Standard Verified' } };
}
