import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { DatabaseError } from '../utils/errors.js';
import { listInquiriesForSeller } from '../services/marketplace/marketplaceInquiryService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Map a marketplace inquiry status onto the lead pipeline vocabulary the dealer Leads page
 * renders (new / contacted / negotiating / closed). Spam is filtered out before this runs.
 */
const INQUIRY_STATUS_TO_LEAD_STATUS = {
  new: 'new',
  assigned: 'new',
  contacted: 'contacted',
  qualified: 'negotiating',
  closed: 'closed',
  rejected: 'closed',
};

/** Project a seller-scoped marketplace inquiry into the lead shape the dealer page renders. */
export function inquiryToLead(inquiry) {
  return {
    id: inquiry.id,
    buyer_name: inquiry.contact_name || null,
    email: inquiry.contact_email || null,
    buyer_phone: inquiry.contact_phone || null,
    vin: inquiry.listing_id || null,
    status: INQUIRY_STATUS_TO_LEAD_STATUS[inquiry.status] || 'new',
    source: inquiry.source_channel || 'Marketplace',
    message: inquiry.message || null,
    created_at: inquiry.created_at,
  };
}

/** Spam never reaches the dealer lead list; everything else maps into the lead pipeline. */
export function inquiriesToLeads(inquiries) {
  return (inquiries || [])
    .filter((inquiry) => inquiry.status !== 'spam')
    .map(inquiryToLead);
}

// --- DEALER: LEADS ---
// Reads REAL buyer intent: marketplace_inquiries scoped to the signed-in seller (seller_id or
// seller_tenant_id) via the shared inquiry service. The previous implementation read a
// `dealer_leads` table that nothing writes and no migration creates.
router.get('/api/leads', authorizeRole(['dealer', 'admin']), asyncHandler(async (req, res) => {
  let inquiries;
  try {
    inquiries = await listInquiriesForSeller(supabase, {
      id: req.userContext.id,
      tenantId: req.userContext.tenantId || null,
    });
  } catch (error) {
    // Keep the historical local-dev grace: an unprovisioned inquiries table yields an empty
    // lead list rather than a 500. Any other database failure still surfaces.
    if (error instanceof DatabaseError && /does not exist/i.test(error.details?.reason || '')) {
      return res.json([]);
    }
    throw error;
  }

  res.json(inquiriesToLeads(inquiries));
}));

export default router;
