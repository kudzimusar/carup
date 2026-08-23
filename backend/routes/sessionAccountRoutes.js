import express from 'express';
import crypto from 'crypto';
import { supabase } from '../db/supabase.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { buildSessionRow } from '../services/auth/sessionRow.js';
import { listUserNotifications } from '../services/notifications/userNotificationService.js';
import { logAuditEvent } from '../services/auditLogger.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

const router = express.Router();
const APPROVED_ROLES = new Set(['owner', 'dealer', 'mechanic', 'insurance', 'government', 'admin', 'bank']);

router.get('/api/auth/me', authorizeRole(), async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, phone, role, avatar')
      .eq('id', req.userContext.id)
      .single();
    if (error || !user) return res.status(401).json({ error: 'Unauthorized. User record not found.' });
    return res.json({
      user: {
        ...user,
        role: req.userContext.role,
        active_tenant_id: req.userContext.tenantId || null,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/api/auth/switch-role', authorizeRole(), async (req, res, next) => {
  const { userId, role, tenantId } = req.body || {};
  const auditBase = {
    req,
    source_route: '/api/auth/switch-role',
    actor_user_id: req.userContext?.id,
    actor_role: req.userContext?.role,
    actor_tenant_id: req.userContext?.tenantId,
    previous_value: { role: req.userContext?.role, tenantId: req.userContext?.tenantId || null },
    new_value: { role: role || null, tenantId: tenantId || null },
  };

  try {
    await logAuditEvent(supabase, { ...auditBase, event_type: 'ROLE_SWITCH_REQUESTED' });
    if (userId !== req.userContext.id) throw new ForbiddenError('Forbidden. You can only switch your own role.');
    if (!role || !APPROVED_ROLES.has(role)) {
      throw new ForbiddenError(`Forbidden. Role '${role}' is not in the approved role catalog.`);
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, name, email, phone, role, avatar')
      .eq('id', userId)
      .single();
    if (userError || !user) throw new NotFoundError('User record not found');

    let verifiedTenantId = null;
    let verifiedTenantRole = null;
    if (tenantId) {
      const { data: tenantUser, error: tenantError } = await supabase
        .from('tenant_users')
        .select('tenant_id, role')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .single();
      if (tenantError || !tenantUser) throw new ForbiddenError('Forbidden. You do not belong to this organization.');
      verifiedTenantId = tenantUser.tenant_id;
      verifiedTenantRole = tenantUser.role;
    }

    const canAssumeRequestedRole = role === user.role ||
      (verifiedTenantRole && role === verifiedTenantRole && role !== 'admin');
    if (!canAssumeRequestedRole) {
      throw new ForbiddenError(`Forbidden. Role '${role}' is not verified for this user context.`);
    }

    const token = `sk_live_${crypto.randomUUID().replace(/-/g, '')}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: sessionError } = await supabase.from('user_sessions').insert(
      buildSessionRow({ userId, activeRole: role, token, expiresAt, req, tenantId: verifiedTenantId }),
    );
    if (sessionError) throw new Error('Could not establish a session for the switched role.');

    await logAuditEvent(supabase, {
      ...auditBase,
      event_type: 'ROLE_SWITCH_GRANTED',
      actor_user_id: userId,
      actor_role: role,
      actor_tenant_id: verifiedTenantId,
    });
    return res.json({
      success: true,
      message: `Role switched to ${role} successfully (session established).`,
      token,
      user: { ...user, role, active_tenant_id: verifiedTenantId },
    });
  } catch (error) {
    await logAuditEvent(supabase, {
      ...auditBase,
      event_type: 'ROLE_SWITCH_DENIED',
      reason: error.message,
    });
    return next(error);
  }
});

router.get('/api/notifications/me', authorizeRole(), async (req, res) => {
  try {
    return res.json(await listUserNotifications(supabase, req.userContext.id));
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
