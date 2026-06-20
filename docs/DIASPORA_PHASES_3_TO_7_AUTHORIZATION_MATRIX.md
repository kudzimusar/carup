# Diaspora Trade OS — Phases 3–7 Authorization Matrix (H4)

Backend is authoritative. Route middleware (`authorizeRole([...])`) is the first gate; service-level
ownership/tenant checks are defense in depth. Frontend role guards mirror this matrix but never
substitute for it. The server-derived `platformRole`/`baseRole` is trusted; the client
`x-stakeholder-role` only sets the *requested* role and cannot escalate (enforced by
`authMiddleware.resolveEffectiveRole`). Platform admins (`admin`, `platform_admin`, `super_admin`)
bypass route allowlists by design but are still subject to service-level ownership/tenant checks.

## Role groups (route allowlists)

- **sellerAuth** = `dealer, admin, platform_admin, super_admin, government, government_reviewer, reviewer`
- **buyerAuth** = `owner, admin, platform_admin, super_admin, government, government_reviewer, reviewer`
- **reviewerAuth** = `admin, platform_admin, super_admin, government, government_reviewer, reviewer`
- **participantAuth** = `owner, dealer, admin, platform_admin, super_admin, government, government_reviewer, reviewer`

`mechanic`, `insurance`, and `bank` are excluded from all Diaspora Phase 3–7 routes.

> **Scope note.** This matrix governs the **Phase 3–7** route modules (stock, buyer-order/RFQ, AI,
> container marketplace, drive), all of which use explicit allowlists. The legacy **Phase 1/2** routes
> in `diasporaRoutes.js` (import-orders, documents, shipments, compliance, etc.) retain their
> pre-existing middleware (`auth` = any authenticated user, with reviewer-only guards on sensitive
> mutations) plus service-level ownership/tenant checks. Tightening those legacy guards is a
> recommended follow-up outside this hardening program's scope.

## Stock & Supply Documents (`diasporaStockRoutes.js`)

| Route | Allowlist | Ownership (service) |
| --- | --- | --- |
| `GET/POST /stock`, `GET/PATCH /stock/:id` | sellerAuth | creator/tenant; reviewers all |
| `GET/POST /stock/:id/ledger` | sellerAuth | item owner/tenant (RPC re-checks) |
| `POST /stock/:id/reserve`, `.../release-reservation` | sellerAuth | item owner/tenant (RPC re-checks) |
| `GET/POST /supply-documents`, `GET/PATCH /supply-documents/:id`, `.../publish`, `.../unpublish` | sellerAuth | creator/tenant |

A buyer/`owner` cannot create seller stock merely by being authenticated.

## Buyer Orders & RFQ (`diasporaBuyerOrderRoutes.js`)

| Route | Allowlist | Ownership (service) |
| --- | --- | --- |
| `GET/POST /buyer-orders`, `GET/PATCH /buyer-orders/:id` | buyerAuth | buyer/owner of order; reviewers all |
| `POST /buyer-orders/:id/publish-rfq` | buyerAuth | order owner |
| `GET /buyer-orders/:id/matches` | buyerAuth | order owner |
| `POST /buyer-orders/:id/accept-quote` | buyerAuth | order owner (atomic RPC re-checks) |
| `POST /buyer-orders/:id/quotes` | sellerAuth | seller creates own quote on a published RFQ |
| `GET /rfqs` | sellerAuth | published RFQs only, excluding own orders |
| `PATCH /quotes/:id`, `POST /quotes/:id/submit`, `.../withdraw` | sellerAuth | quote owner only |

## AI Commands (`diasporaAiCommandRoutes.js`)

| Route | Allowlist | Ownership (service) |
| --- | --- | --- |
| `POST /ai-commands/parse`, `POST/GET /ai-commands`, `GET /ai-commands/:id` | participantAuth | requester owns own commands; reviewers all |
| `POST /ai-commands/:id/confirm` | participantAuth | requester or reviewer (medium-risk) |
| `POST /ai-commands/:id/reject` | participantAuth | requester or reviewer |
| `POST /ai-commands/:id/approve` | reviewerAuth | reviewer/admin only (high-risk) |
| `POST /ai-commands/:id/execute` | participantAuth | re-validates risk/gate; high-risk blocked |

## Container Marketplace (`diasporaContainerMarketplaceRoutes.js`)

| Route | Allowlist | Ownership (service) |
| --- | --- | --- |
| `GET /container-marketplace/containers`, `.../:id/capacity`, `.../:id/reservations` | participantAuth | participant-safe filtering |
| `POST /container-marketplace/containers/:id/reservations` | participantAuth | reservation created as the actor |
| `POST /container-marketplace/reservations/:id/cancel` | participantAuth | owner or reviewer (service-checked) |
| `POST /container-marketplace/containers` (create) | reviewerAuth | logistics |
| `POST /container-marketplace/containers/:id/close-booking` | reviewerAuth | logistics |
| `POST /container-marketplace/reservations/:id/approve`, `.../reject` | reviewerAuth | atomic RPC re-checks tenant-admin authority |

## Drive (`diasporaDriveRoutes.js`)

| Route | Allowlist | Ownership (service) |
| --- | --- | --- |
| `GET /drive/status`, `GET /drive/google/authorize`, `GET /drive/google/callback`, `POST /drive/disconnect`, `GET /drive/files`, `POST /drive/{upload,export,sync}` | participantAuth | user accesses only own connection/files; tokens never exposed |

## Enforcement tests

`backend/tests/diaspora-route-authorization.test.js` drives the real router over HTTP with a mocked
Supabase and proves, per representative route:

- a disallowed authenticated role receives `403`;
- an allowed role passes the route gate (reaches the service);
- a spoofed `x-stakeholder-role` does not escalate;
- a cross-tenant `x-tenant-id` (non-member) is rejected.
