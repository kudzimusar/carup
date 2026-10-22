import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole, requireActiveTenant } from '../middleware/authMiddleware.js';
import {
  GARAGE_ADMIN_ROLES,
  GARAGE_TENANT_TYPE,
  GARAGE_WORKSPACE_ROLES,
} from '../services/serviceNetwork/serviceAuthority.js';
import {
  addGarageStaffCertification,
  addGarageStaffSkill,
  assignGarageStaffBranch,
  createGarageBranch,
  createGarageDepartment,
  endGarageStaffBranchAssignment,
  listGarageBranches,
  listGarageDepartments,
  listGarageStaffOperations,
  removeGarageStaffCertification,
  removeGarageStaffSkill,
  replaceGarageBranchHours,
  setGarageBranchActive,
  updateGarageBranch,
  updateGarageDepartment,
  upsertGarageStaffProfile,
} from '../services/serviceNetwork/garageOperationsService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const GARAGE_WORKSPACE = [
  authorizeSessionRole(),
  requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_WORKSPACE_ROLES }),
];

const GARAGE_ADMIN = [
  authorizeSessionRole(),
  requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_ADMIN_ROLES }),
];

// ── Sites ──────────────────────────────────────────────────────────────────────

router.get('/api/garage/operations/branches', ...GARAGE_WORKSPACE, asyncHandler(async (req, res) => {
  res.json(await listGarageBranches(supabase, req.userContext));
}));

router.post('/api/garage/operations/branches', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await createGarageBranch(supabase, req.userContext, req.body || {}, { req });
  res.status(201).json(result);
}));

router.patch('/api/garage/operations/branches/:branchId', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await updateGarageBranch(supabase, req.userContext, req.params.branchId, req.body || {}, { req }));
}));

router.put('/api/garage/operations/branches/:branchId/hours', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await replaceGarageBranchHours(
    supabase,
    req.userContext,
    req.params.branchId,
    req.body?.hours,
    { req },
  ));
}));

router.post('/api/garage/operations/branches/:branchId/activate', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await setGarageBranchActive(supabase, req.userContext, req.params.branchId, true, { req }));
}));

router.post('/api/garage/operations/branches/:branchId/deactivate', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await setGarageBranchActive(supabase, req.userContext, req.params.branchId, false, { req }));
}));

// ── Departments ────────────────────────────────────────────────────────────────

router.get('/api/garage/operations/departments', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await listGarageDepartments(supabase, req.userContext));
}));

router.post('/api/garage/operations/departments', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await createGarageDepartment(supabase, req.userContext, req.body || {}, { req });
  res.status(201).json(result);
}));

router.patch('/api/garage/operations/departments/:departmentId', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await updateGarageDepartment(
    supabase,
    req.userContext,
    req.params.departmentId,
    req.body || {},
    { req },
  ));
}));

// ── Workforce ──────────────────────────────────────────────────────────────────

router.get('/api/garage/operations/staff', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await listGarageStaffOperations(supabase, req.userContext));
}));

router.put('/api/garage/operations/staff/:userId/profile', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await upsertGarageStaffProfile(
    supabase,
    req.userContext,
    req.params.userId,
    req.body || {},
    { req },
  ));
}));

router.post('/api/garage/operations/staff/:userId/branches', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  const result = await assignGarageStaffBranch(
    supabase,
    req.userContext,
    req.params.userId,
    req.body || {},
    { req },
  );
  res.status(result?.created === true ? 201 : 200).json(result);
}));

router.delete('/api/garage/operations/staff/:userId/branches/:assignmentId', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await endGarageStaffBranchAssignment(
    supabase,
    req.userContext,
    req.params.assignmentId,
    req.body?.reason || req.query?.reason,
    { req },
  ));
}));

router.post('/api/garage/operations/staff/:userId/skills', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.status(201).json(await addGarageStaffSkill(
    supabase,
    req.userContext,
    req.params.userId,
    req.body || {},
    { req },
  ));
}));

router.delete('/api/garage/operations/staff/:userId/skills/:skillCode', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await removeGarageStaffSkill(
    supabase,
    req.userContext,
    req.params.userId,
    req.params.skillCode,
    { req },
  ));
}));

router.post('/api/garage/operations/staff/:userId/certifications', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.status(201).json(await addGarageStaffCertification(
    supabase,
    req.userContext,
    req.params.userId,
    req.body || {},
    { req },
  ));
}));

router.delete('/api/garage/operations/staff/:userId/certifications/:certificationId', ...GARAGE_ADMIN, asyncHandler(async (req, res) => {
  res.json(await removeGarageStaffCertification(
    supabase,
    req.userContext,
    req.params.userId,
    req.params.certificationId,
    { req },
  ));
}));

export default router;
