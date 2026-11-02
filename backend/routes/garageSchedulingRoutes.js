
import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import {
  GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE, GARAGE_WORKSPACE_ROLES,
} from '../services/serviceNetwork/serviceAuthority.js';
import {
  addWorkforceRecurringSchedule,
  addWorkforceUnavailability,
  cancelRequesterAppointment,
  confirmGarageAppointment,
  getGarageAppointmentAvailability,
  getGarageSchedule,
  getGarageSchedulingConfiguration,
  getRequesterAppointmentAvailability,
  listRequesterAppointments,
  requestAppointment,
  rescheduleGarageAppointment,
  transitionGarageAppointment,
  updateBranchSchedulingSettings,
} from '../services/garageOperations/garageSchedulingService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const REQUESTER_ROLES = ['owner', 'dealer', 'mechanic', 'admin'];
const GARAGE_WORKSPACE = [
  authorizeSessionRole(),
  requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_WORKSPACE_ROLES }),
];
const GARAGE_ADMIN = [
  authorizeSessionRole(),
  requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES }),
];

// Requester-side scheduling remains Service-Case-scoped. The Garage is derived from the case.
router.get('/api/service-cases/:caseId/appointment-availability',
  authorizeSessionRole(REQUESTER_ROLES),
  asyncHandler(async (req, res) => {
    res.json(await getRequesterAppointmentAvailability(supabase, req.userContext, req.params.caseId, req.query));
  }));

router.post('/api/service-cases/:caseId/appointments',
  authorizeSessionRole(REQUESTER_ROLES),
  asyncHandler(async (req, res) => {
    res.status(201).json(await requestAppointment(supabase, req.userContext, req.params.caseId, req.body));
  }));

router.get('/api/service-appointments/mine',
  authorizeSessionRole(REQUESTER_ROLES),
  asyncHandler(async (req, res) => {
    res.json(await listRequesterAppointments(supabase, req.userContext));
  }));

router.post('/api/service-cases/:caseId/appointments/:appointmentId/cancel',
  authorizeSessionRole(REQUESTER_ROLES),
  asyncHandler(async (req, res) => {
    res.json(await cancelRequesterAppointment(
      supabase, req.userContext, req.params.caseId, req.params.appointmentId,
    ));
  }));

// Garage workspace reads are admin/mechanic. Mutation/configuration is initially admin-only.
router.get('/api/garage/schedule', GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await getGarageSchedule(supabase, req.userContext, req.query));
}));

router.get('/api/garage/schedule/availability', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await getGarageAppointmentAvailability(supabase, req.userContext, req.query));
}));

router.get('/api/garage/schedule/configuration', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await getGarageSchedulingConfiguration(supabase, req.userContext));
}));

router.put('/api/garage/schedule/sites/:siteId/settings', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await updateBranchSchedulingSettings(
    supabase, req.userContext, req.params.siteId, req.body,
  ));
}));

router.post('/api/garage/schedule/workforce/:userId/recurring', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.status(201).json(await addWorkforceRecurringSchedule(
    supabase, req.userContext, req.params.userId, req.body,
  ));
}));

router.post('/api/garage/schedule/workforce/:userId/unavailability', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.status(201).json(await addWorkforceUnavailability(
    supabase, req.userContext, req.params.userId, req.body,
  ));
}));

router.post('/api/garage/schedule/appointments/:appointmentId/confirm', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await confirmGarageAppointment(
    supabase, req.userContext, req.params.appointmentId, req.body,
  ));
}));

router.post('/api/garage/schedule/appointments/:appointmentId/reschedule', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await rescheduleGarageAppointment(
    supabase, req.userContext, req.params.appointmentId, req.body,
  ));
}));

router.post('/api/garage/schedule/appointments/:appointmentId/status', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await transitionGarageAppointment(
    supabase, req.userContext, req.params.appointmentId, req.body?.status,
  ));
}));

export default router;
