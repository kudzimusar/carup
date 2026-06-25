# Referral Engine Wave A Implementation Plan

**Status:** Approved for Implementation

This plan details the technical steps to complete **Wave A: Identity, attribution and universal sharing** from the Full-Vision MVP Completion Plan, incorporating all mandatory architectural revisions.

## 1. Approved Decisions & Dependencies

1. **QR Rendering**: Add `qrcode.react` to `web/package.json`.
2. **Web Renderer**: Use `QRCodeSVG` as the default web renderer.
3. **Mobile QR**: Implement a mobile-compatible QR renderer separately (`qrcode.react` does not satisfy native mobile).
4. **Barcode Validation Context**: Must be passed in the JSON request body (not as headers or query parameters).
5. **Issuance Ownership**: Permanent-code issuance is entirely backend-owned.
6. **Auth Integration**: `AuthContext` may call the bootstrap endpoint, but it must not generate or own the referral code itself.
7. **Triggers**: Do not rely solely on an `auth.users` trigger for code creation.

## 2. Auth Provisioning Architecture

Implement `ensurePermanentMemberCode(authenticatedUserId, tenantId)` in the referral engine service.

**Call Paths:**
1. The real backend `/auth/register` completion path.
2. Authenticated session/login bootstrap as a repair mechanism.
3. The Universal Referral Widget load as an idempotent fallback.

**Rules:**
- Referral provisioning failure must **not** destroy an otherwise successful user registration.
- If provisioning fails, record the failure and allow retry on the next bootstrap/widget load.
- Create a repair/backfill script in `scripts/` to provision existing eligible users who lack a permanent code.

## 3. Permanent-Code Database Invariant

To guarantee uniqueness without race conditions:
1. Add an explicit `is_permanent` boolean column to `referral_codes` (default `false`).
2. Create a **partial unique index** that guarantees exactly one permanent `MEMBER` code per tenant and owner:
   `CREATE UNIQUE INDEX idx_referral_codes_permanent_owner ON referral_codes(tenant_id, owner_user_id) WHERE is_permanent = true;`
3. **Concurrency Guarantee**: Do not use "find-then-insert". Attempt the `INSERT`, and on a unique constraint violation, catch the error, fetch, and return the existing code.
4. **Testing**: Write tests to prove the race condition against a real Postgres/Supabase database (not just an in-memory test).

## 4. Migrations

Create a timestamped additive migration. Do not use generic incrementing numbers like `017`.
- **Filename**: `database/migrations/20260625120000_referral_wave_a_identity_attribution.sql` (using the current timestamp).

## 5. Attribution Data Model

Do NOT create a single `user_id`-unique row for attributions. Do NOT store touches in a UUID array.

Implement two new tables:

### A. `referral_attribution_journeys`
- Represents an end-to-end attribution lifecycle.
- **Columns**: `id`, `tenant_id`, `anonymous_journey_id` (for pre-login), `user_id` (optional authenticated binding), `first_touch_id`, `last_touch_id`, `reward_owner_user_id` (immutable), `campaign_id`, `status`, `created_at`, `updated_at`.
- **Note**: A user may have multiple journeys. `user_id` is not globally unique in this table.

### B. `referral_attribution_touches`
- Append-only history of every touch.
- **Columns**: `id`, `tenant_id`, `journey_id`, `touch_kind` (first, last, assisted), `code_id`, `campaign_id`, `channel`, `source`, `session_id`, `subject_type`, `subject_id`, `actor_type`, `actor_user_id`, `occurred_at`, `metadata` (sanitized), `idempotency_key` (UNIQUE), `created_at`.
- Each touch must correlate to a `referral_events` audit event.

## 6. RLS and Authorization

Preserve the server-owned Referral Engine model:
- Enable RLS on all new tables.
- Do NOT grant broad anonymous/authenticated table access or add permissive browser policies.
- All data access must flow through authorized backend routes using service-role or elevated context.

**Permissions:**
- **Owner**: Can see their own permanent code, summary, and permitted attribution view.
- **Admin**: Can inspect tenant-scoped attributions.
- **Public**: Limited to bounded, tracked referral entry paths only.

## 7. API Endpoints

### Self-Scoped Routes (Owner)
- `POST /api/referrals/me/bootstrap`: Ensures the permanent code exists (uses `req.userContext.id`).
- `GET /api/referrals/me/summary`: Returns a bounded response (permanent code, share assets, wallet totals, referred-user count, conversion count, active campaigns).
- `GET /api/referrals/me/attribution`: Returns the owner's authorized attribution state.

### Authenticated Claim
- `POST /api/referrals/attribution/claim`: Binds an anonymous journey token to the newly authenticated user.

### Admin Routes
- `GET /api/referrals/admin/attributions/:userId`: Exposes the full touch path for support/admin inspection.

*Rule*: Never accept a `user_id` from the client for self-bootstrap.

## 8. Public Referral Entry (`/r/:code`)

Implement the exact public contract `/r/:code`.
**Flow**:
1. Request arrives at `/r/:code`.
2. Validate the code.
3. Create (or retrieve) an opaque attribution journey.
4. Record the touch (link/QR/social).
5. Persist the anonymous journey identifier (opaque token, no browser fingerprinting).
6. Redirect to a trusted CarUp destination (e.g., signup or campaign landing).

**Rules**:
- Do not allow arbitrary redirect URLs.
- Do not place PII or user IDs in the URL.
- Implement rate-limiting.
- Handle invalid/expired/disabled codes safely and clearly.

## 9. Cross-Surface Continuation

Support the flow: `Anonymous Web Visit -> Registration -> Login -> Marketplace Inquiry/Quote -> WhatsApp/Telegram Handoff -> Mobile Deep Link -> Agent-Assisted Conversion`.
- Bind the anonymous journey to the authenticated user via the opaque journey token.
- **First touch** remains the default reward owner.
- Later touches may update last/assisted attribution but CANNOT replace the reward owner unless future campaign rules explicitly allow it.

## 10. Barcode Context

Extend validation route to accept a body contract:
```json
{
  "code": "CODE",
  "channel": "barcode",
  "session_id": "session-123",
  "scan_context": {
    "type": "agent", // "agent" | "depot" | "invoice" | "booking" | "pickup"
    "reference_id": "optional-ref",
    "location_id": "optional-loc"
  }
}
```
*Rule*: Barcode validation records evidence only. It must NEVER create, approve, or mature a reward.

## 11. Universal Referral Widget

Web and Mobile must display:
- Personal permanent code.
- Copy button.
- WhatsApp & Telegram share.
- Supported Web Share / Native Share.
- Rendered QR (SVG on web).
- QR download (web only).
- Pending, approved, and settled rewards.
- Referred-user/conversion summary.
- Active campaigns.

*Rule*: Keep a separate "Validate another code" action. Do NOT remove existing explanation and dispute capabilities.

## 12. Testing Requirements

### Web Tests
- Code automatically appears; QR is scannable; SVG download works; copy fallback works.
- Accessible QR title.
- `navigator.share` paths (supported vs unsupported).
- WhatsApp/Telegram/Facebook links.
- Wallet/summary rendering.
- Loading, empty, and error states.
- Responsive layout (desktop/tablet/mobile).

### Mobile Tests
- Code display; QR rendering; native Share; wallet/campaign summary.
- Offline/error states; attribution deep-link claim.

### Security Tests
- One permanent code per tenant/user.
- Repeat/concurrent bootstrap tests.
- Owner cannot bootstrap another user or inspect another journey.
- Admin access is tenant-scoped.
- Anonymous token cannot be guessed/reassigned.
- Self-referral is rejected.
- Later touch cannot replace reward owner.
- Duplicate/idempotent touch handling.
- Arbitrary redirect rejected.
- Metadata sanitized.
- QR/barcode validation never creates a reward.

### Regression
Run migration tests, backend unit/integration tests, web TS/Vitest, mobile TS, Playwright, existing 67/67 UAT, referral CI, secret scan, and Supabase advisors.

## 13. Delivery Plan
- Complete code changes.
- Commit and push to `feat/referral-wave-a-identity-attribution`.
- Open a PR with evidence (migrations, tests, screenshots, UAT results, coverage matrix).
- Do not merge, deploy production, or release mobile.
