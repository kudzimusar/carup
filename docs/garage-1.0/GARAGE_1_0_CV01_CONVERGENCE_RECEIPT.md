# GARAGE-1.0-CV01 — Current Authority Convergence Receipt

## Custody

- Programme: `CARUP GARAGE-1.0 — BUSINESS OPERATING SYSTEM COMPLETION`
- Unit: `GARAGE-1.0-CV01`
- Exact parent: `166025842bc2bae024c13162c2f3623617f88277`
- Inherited AUTH-05 head: `32be52360bb38987ba4a72e644f118d643b34f7e`
- Working branch: `integration/garage-1.0-cv01-current-authority`
- Historical parity sources only:
  - PR #197: `c23f012c4399f472eb6a9cae89b67fcc15a4ed40`
  - PR #209 certified product tree: `5bc3c96eaba410d98478ec2f8208d378029d0b2f`
  - PR #209 documentation head: `ce45e16f1b52b4eb59cb49e5955cc4830db0cf97`

CV01 does not merge or rebase either historical branch and does not replay superseded September migrations.

## Bounded repair

The one proven current-authority defect entering CV01 was the legacy parts route.

Before CV01, `GET/POST /api/mechanic/parts` used:

`authorizeRole(['mechanic', 'admin'])`

That gate resolved a verified tenant context, but it did not require the selected organisation to be a Garage and expressed permission through platform/effective-role vocabulary rather than the canonical Garage tenant-role boundary.

CV01 changes the route to the same authority contract used by the current Service Network:

- `authorizeSessionRole()`;
- `requireActiveTenant({ types: [GARAGE_TENANT_TYPE], roles: GARAGE_WORKSPACE_ROLES })`;
- inventory queries and inserts derive `tenant_id` from `req.userContext.activeTenant.id`.

`GARAGE_WORKSPACE_ROLES` is the existing canonical `['admin', 'mechanic']` set. Both roles retain the pre-CV01 read/create behaviour. Platform administrator status does not substitute for Garage membership.

No new parts table, inventory feature or migration is introduced.

## Parity matrix

| Historical/accepted capability | CV01 classification | Current authority |
|---|---|---|
| Garage application / business intent | PRESENT_AND_HARDENED | Current OCR C3 + Garage onboarding services/routes |
| Business-presence evidence + OCR provenance | PRESENT_AND_HARDENED | Current Garage application evidence authority |
| Review decision separated from activation | PRESENT_AND_HARDENED | Current Garage review + activation services |
| Atomic Garage activation | PRESENT_AND_HARDENED | Current GMO activation authority |
| Exactly one Garage tenant + founding membership | PRESENT_AND_HARDENED | Current activation RPC/service |
| Founding tenant `admin` separated from platform role | PRESENT_AND_HARDENED | Current tenant role catalogue + activation |
| Garage invitations | PRESENT_AND_HARDENED | Hashed, expiring, revocable current invitation authority |
| Verified-email, atomic invitation acceptance | PRESENT_AND_HARDENED | Current GMO invitation acceptance |
| Membership removal / role change | PRESENT_AND_HARDENED | Current Garage membership service |
| Last-admin protection | PRESENT_AND_HARDENED | Current serialized GMO guard |
| Historical work attribution after membership revocation | PRESENT_AND_HARDENED | Current assignment/service-record authority |
| Garage public identity/profile | PRESENT_AND_HARDENED | Current Service Network Garage profile authority |
| Publish / unpublish | PRESENT_AND_HARDENED | Current Garage directory service |
| Garage Directory / Detail | PRESENT_AND_HARDENED | Current public directory/detail routes and UI |
| Targeted service request | PRESENT_AND_HARDENED | Current Service Case authority |
| Service Case lifecycle | PRESENT_AND_HARDENED | Current Service Network services |
| Garage queue | PRESENT_AND_HARDENED | Current Garage queue route/service |
| Service Case → Work Order | PRESENT_AND_HARDENED | Current Service Work Order authority |
| Branch attribution and validation | PRESENT_AND_HARDENED | Current Garage branch relation + composite ownership checks |
| Mechanic assignment + assignment history | PRESENT_AND_HARDENED | Current durable assignment authority |
| Completion / cancellation timestamps and reason | PRESENT_AND_HARDENED | Current work-order lifecycle |
| Service records | PRESENT_AND_HARDENED | Current Service Record authority |
| Mileage observations without overwriting canonical odometer | PRESENT_AND_HARDENED | Current mileage observation service |
| Service evidence | PRESENT_AND_HARDENED | Current evidence-use authority |
| PartSentry linkage | PRESENT_AND_HARDENED | Current work-order-attested PartSentry linkage |
| Service Link | PRESENT_AND_HARDENED | Current opaque link + capability authority |
| Owner service history | PRESENT_AND_HARDENED | Current owner service history projection |
| Mechanic attribution/history | PRESENT_AND_HARDENED | Current assignment/service record projections |
| Garage customer projection | PRESENT_AND_HARDENED | Current Garage customer service projection |
| Garage/mechanic intelligence | PRESENT_AND_HARDENED | Current governed intelligence projections with explicit NOT_MEASURABLE boundaries |
| `mechanic_parts` basic parts master | PRESENT_EQUIVALENT | Existing tenant parts table, API and UI preserved |
| Parts route Garage authority | MISSING_VALID_CAPABILITY → REPAIRED_IN_CV01 | CV01 moves GET/POST onto canonical selected-active-Garage authority |
| Legacy `garageContextService.js` authority | LEGACY_BEHAVIOUR_CORRECTLY_DROPPED | Superseded by `activeTenantContext.js` and session-selected organisation |
| Legacy `GarageContextSwitcher.tsx` authority role | LEGACY_BEHAVIOUR_CORRECTLY_DROPPED | Browser does not maintain an independent Garage authority plane |
| September Service Network / GMO migration sequence | SUPERSEDED_BY_CURRENT_AUTHORITY | Current October convergence migrations are canonical |
| Corporate membership as Garage operating membership | LEGACY_BEHAVIOUR_CORRECTLY_DROPPED / NOT APPLICABLE | Corporate governance and Garage `tenant_users` remain separate authority planes |

## Missing valid historical capability

No additional `MISSING_VALID_CAPABILITY` was proven by CV01 beyond the parts-route authority mismatch described above.

This statement does not claim Garage-1.0 is feature-complete. Multi-site operations, workforce structure, CRM, scheduling, workshop capacity, full inventory/stock control, procurement, quoting, invoicing and payments remain later product tranches by programme authority.

## Security boundaries preserved

CV01 changes no semantics in:

- `backend/services/auth/sessionAuthority.js`
- `backend/services/auth/sessionAuthorityTls.js`
- `backend/services/auth/activeTenantContext.js`
- `backend/middleware/authMiddleware.js`
- `backend/services/auth/tenantRoleCatalogue.js`
- Corporate authority services/routes
- AUTH-05 migrations

The parts route now consumes those current authorities rather than defining another one.

## Migration status

No migration is added, removed, renamed or modified by CV01.

The existing `mechanic_parts` master remains authoritative, including its `UNIQUE(tenant_id, sku)` contract.

## No-fabrication boundary

CV01 does not change the established parts UI truthfulness rules: unread inventory is not rendered as zero, absent supplier is not invented, absent threshold is not invented by the projection, and missing stock/price values are not silently coerced into measured zeroes.
