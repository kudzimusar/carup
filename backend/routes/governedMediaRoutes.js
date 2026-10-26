import express from 'express';
import { supabase } from '../db/supabase.js';
import { optionalAuth } from '../middleware/authMiddleware.js';
import {
  actorForGovernedMedia, createStorageSigner, readGovernedMedia,
} from '../services/evidence/governedVehicleMediaService.js';

/**
 * T11-CAP-LR01-R2 step F — a vehicle's GOVERNED MEDIA, in full.
 *
 * One read-only route: the whole gallery of one vehicle for the people entitled to it (its owner, and the platform roles the
 * passport already admits), each photograph with a short-lived view. A garage list and the passport carry the same block through
 * their own responses; this route exists for the surfaces that need the whole gallery without a whole passport (the owner's
 * vehicle page, the Seller workspace).
 *
 * EVERY refusal is the same 404 with the same body — an anonymous caller, an asserted identity, a signed-in stranger, and a vehicle
 * that does not exist — so the route cannot be used to learn that a vehicle exists, that it has photographs, or whose they are.
 * `optionalAuth()` is deliberate: it resolves a PROVEN identity when one is present and never blocks, and the service then decides.
 */
export function createGovernedMediaRouter({ client = supabase, signer = createStorageSigner(supabase), auth = optionalAuth() } = {}) {
  const router = express.Router();

  router.get('/api/vehicles/:vin/governed-media', auth, async (req, res, next) => {
    try {
      const refuse = () => res.status(404).json({ error: 'Not found' });
      const vin = String(req.params.vin || '').trim();
      const actor = actorForGovernedMedia(req.userContext);
      if (!vin || !actor.id || actor.identityAsserted) return refuse();
      const { data: vehicle, error } = await client.from('vehicles').select('vin, owner_id').eq('vin', vin).maybeSingle();
      if (error) return next(error);
      if (!vehicle) return refuse();
      const block = await readGovernedMedia({ client, vehicle, actor, signer });
      if (!block) return refuse();
      res.set('Cache-Control', 'private, no-store');
      return res.json({ data: block });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createGovernedMediaRouter;
