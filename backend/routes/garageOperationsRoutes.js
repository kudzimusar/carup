import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import { GARAGE_ADMIN_ROLES, GARAGE_TENANT_TYPE } from '../services/serviceNetwork/serviceAuthority.js';
import {
  listGarageSites,
  getGarageSite,
  createGarageSite,
  updateGarageSite,
  setGarageSiteStatus,
  setGarageSiteManager,
  listGarageDepartments,
  createGarageDepartment,
  updateGarageDepartment,
  listGarageWorkforce,
  getGarageWorkforceProfile,
  upsertGarageWorkforceProfile,
  setGarageWorkforceStatus,
  setGarageWorkforceBranches,
  replaceGarageWorkforceSkills,
  addGarageWorkforceCertification,
} from '../services/garageOperations/garageOperationsService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const GARAGE_ADMIN = [
  authorizeSessionRole(),
  requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES }),
];

router.get('/api/garage/sites', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await listGarageSites(supabase, req.userContext));
}));

router.get('/api/garage/sites/:siteId', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await getGarageSite(supabase, req.userContext, req.params.siteId));
}));

router.post('/api/garage/sites', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await createGarageSite(supabase, req.userContext, req.body, { req });
  res.status(201).json(result);
}));

router.patch('/api/garage/sites/:siteId', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await updateGarageSite(supabase, req.userContext, req.params.siteId, req.body, { req }));
}));

router.patch('/api/garage/sites/:siteId/status', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await setGarageSiteStatus(supabase, req.userContext, req.params.siteId, req.body?.status, { req }));
}));

router.patch('/api/garage/sites/:siteId/manager', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await setGarageSiteManager(supabase, req.userContext, req.params.siteId, req.body?.user_id ?? null, { req }));
}));

router.get('/api/garage/departments', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await listGarageDepartments(supabase, req.userContext));
}));

router.post('/api/garage/departments', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await createGarageDepartment(supabase, req.userContext, req.body, { req });
  res.status(201).json(result);
}));

router.patch('/api/garage/departments/:departmentId', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await updateGarageDepartment(supabase, req.userContext, req.params.departmentId, req.body, { req }));
}));

router.get('/api/garage/workforce', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await listGarageWorkforce(supabase, req.userContext));
}));

router.get('/api/garage/workforce/:userId', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await getGarageWorkforceProfile(supabase, req.userContext, req.params.userId));
}));

router.post('/api/garage/workforce', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await upsertGarageWorkforceProfile(supabase, req.userContext, req.body?.user_id, req.body, { req });
  res.status(result.created ? 201 : 200).json(result);
}));

router.patch('/api/garage/workforce/:userId', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await upsertGarageWorkforceProfile(supabase, req.userContext, req.params.userId, req.body, { req }));
}));

router.patch('/api/garage/workforce/:userId/status', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await setGarageWorkforceStatus(supabase, req.userContext, req.params.userId, req.body?.status, { req }));
}));

router.put('/api/garage/workforce/:userId/branches', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await setGarageWorkforceBranches(supabase, req.userContext, req.params.userId, req.body, { req }));
}));

router.put('/api/garage/workforce/:userId/skills', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await replaceGarageWorkforceSkills(supabase, req.userContext, req.params.userId, req.body?.skills, { req }));
}));

router.post('/api/garage/workforce/:userId/certifications', GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await addGarageWorkforceCertification(supabase, req.userContext, req.params.userId, req.body, { req });
  res.status(201).json(result);
}));

export default router;
