# GARAGE-1.0-OPS01 — Multi-Site + Staff Operations Foundation

Repository: `kudzimusar/carup`

Programme: **CARUP GARAGE-1.0 — BUSINESS OPERATING SYSTEM COMPLETION**

Parent authority:

`748a369055c11aed2d38b051945c3488f582ec9f`

That parent is the green GARAGE-1.0-CV01 exact head, itself rooted at Corporate closure authority
`166025842bc2bae024c13162c2f3623617f88277` and inheriting AUTH-05
`32be52360bb38987ba4a72e644f118d643b34f7e`.

## 1. Product purpose

OPS01 adds the first missing Garage Business Operating System layer after convergence:

- real multi-site Garage branches;
- branch code, manager, contact and operating status;
- authoritative opening hours;
- departments;
- structured staff operating profiles;
- staff-to-branch placement with one optional primary site;
- staff skills;
- staff certifications;
- durable site-placement history.

OPS01 does **not** add CRM, bookings, bays/capacity, shifts/rosters, quoting, invoicing, payments,
inventory, suppliers or accounting. Those remain later Garage tranches.

## 2. Authority invariants

OPS01 does not create a second tenant, branch or membership universe.

- `tenants` remains organization identity.
- `garage_branches` remains the canonical Garage site authority.
- `tenant_users` remains the canonical Garage membership and access authority.
- `mechanic_work_orders` remains the canonical work-order authority.
- AUTH-05 remains the session identity authority.
- Corporate memberships/permissions remain separate from Garage operational membership.

The OPS01 metadata tables never grant application authority. A department, profile, skill,
certification or site assignment without a live `tenant_users` membership grants nothing.

## 3. New authoritative model

Migration:

`database/migrations/20261022090000_garage_ops01_multisite_workforce.sql`

### Existing `garage_branches` extended

- `code`
- `contact_phone`
- `contact_email`
- `manager_user_id`

A branch manager must be a current `admin` member of the same Garage. A branch manager cannot be
demoted or removed until branch management is explicitly reassigned or cleared.

### `garage_branch_hours`

Stores explicit weekday operating windows. Missing rows mean **not recorded**, never an inferred
schedule.

### `garage_departments`

Tenant-scoped operational departments with code, name and active state.

### `garage_staff_profiles`

Structured operating metadata for a current Garage member:

- employee code;
- job title;
- department;
- employment type;
- work phone;
- start date.

This table is not an authorization source.

### `garage_staff_branch_assignments`

Durable branch placement history. Live placement ends with `ended_at`; rows cannot be physically
deleted. At most one live assignment exists for a user/site pair and at most one live primary site
exists for a user.

Membership removal closes live placements in the same database transaction before deleting the
membership. Historical work-order/service attribution remains untouched.

### Skills and certifications

`garage_staff_skills` and `garage_staff_certifications` are structured workforce facts for
current members. They do not alter Garage roles or permissions.

## 4. Database enforcement

OPS01 protects the operating model below the HTTP layer:

- branch manager must be a same-Garage admin;
- a current branch manager cannot be demoted;
- staff metadata writes require current Garage membership;
- staff branch assignment requires an active branch of the same Garage;
- placement history cannot be deleted;
- branch-hours replacement is atomic;
- staff branch assignment is atomic;
- removal of a Garage member remains last-admin safe and additionally closes live placements;
- removal of a current branch manager is refused;
- new tables are FORCE-RLS / service-role-only;
- browser `anon` and `authenticated` roles have no direct table authority.

## 5. API surface

New routes are under:

`/api/garage/operations/*`

Branches:
- `GET /api/garage/operations/branches`
- `POST /api/garage/operations/branches`
- `PATCH /api/garage/operations/branches/:branchId`
- `PUT /api/garage/operations/branches/:branchId/hours`
- `POST /api/garage/operations/branches/:branchId/activate`
- `POST /api/garage/operations/branches/:branchId/deactivate`

Departments:
- `GET /api/garage/operations/departments`
- `POST /api/garage/operations/departments`
- `PATCH /api/garage/operations/departments/:departmentId`

Staff operations:
- `GET /api/garage/operations/staff`
- `PUT /api/garage/operations/staff/:userId/profile`
- `POST /api/garage/operations/staff/:userId/branches`
- `DELETE /api/garage/operations/staff/:userId/branches/:assignmentId`
- `POST /api/garage/operations/staff/:userId/skills`
- `DELETE /api/garage/operations/staff/:userId/skills/:skillCode`
- `POST /api/garage/operations/staff/:userId/certifications`
- `DELETE /api/garage/operations/staff/:userId/certifications/:certificationId`

All writes are Garage-admin actions. Branch reads are available to verified Garage workspace
members. Every request derives the tenant from the current verified active-organization context.

The legacy `/api/garage/branches` write URLs remain as compatibility paths but delegate to the
same OPS01 service authority, so they cannot bypass live-work deactivation safeguards.

## 6. Web product surface

New Garage workspace:

`/garage/operations` — **Sites & Staff**

It supports:

- branch creation and editing;
- site manager assignment;
- activate/deactivate;
- explicit opening hours;
- department creation;
- staff operating profiles;
- site placement / primary site;
- skills;
- certifications.

Invitations, Garage membership roles and removal remain on the existing `/garage/team` surface.
OPS01 deliberately does not duplicate that access lifecycle.

## 7. Truth rules

- Missing opening hours are not rendered or stored as an invented 08:00–17:00 schedule.
- Missing staff metadata remains absent.
- A failed read is not rendered as an empty business.
- Site assignment does not imply access.
- Staff role remains sourced from `tenant_users`, never profile/job-title text.
- Branch intelligence may use branch attribution only where a governed branch id exists.
- Team-performance metrics remain out of scope until scheduling/working-time denominators exist.

## 8. Certification requirements

OPS01 must prove:

1. exact parent is the green CV01 head;
2. AUTH-05 / Corporate authority blobs remain unchanged;
3. the migration applies on the current Garage authority;
4. non-admin branch managers are rejected at the database;
5. branch-manager demotion/removal is rejected until reassignment;
6. non-members cannot receive workforce metadata;
7. cross-tenant/inactive branch placement is rejected;
8. malformed hours replacement is atomic;
9. membership removal closes live placements while preserving placement history;
10. legacy branch URLs use OPS01 authority;
11. existing Garage onboarding, Service Network, membership and work-order regressions remain green;
12. web typecheck/build succeeds;
13. no staging or Production mutation is required for source certification.

## 9. Production boundary

Production Supabase:

`vhmnajoeicasaigiophh`

remains forbidden. OPS01 source certification does not require production or staging mutation.
