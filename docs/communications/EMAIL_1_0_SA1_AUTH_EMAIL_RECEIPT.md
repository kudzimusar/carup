# SA1 — Supabase Auth Email Branding + Resend Delivery

**Branch / PR:** `feat/communications-email-transport` / PR #163
**Date:** 2026-08-17
**Status:** **SA1.0 reconciliation complete — BLOCKED at an architecture decision only the owner can make.**

---

## SA1.0 — Live auth reconciliation: the premise does not hold

SA1 was specified on the basis that **Supabase Auth is CarUp's authentication authority and token
lifecycle**. Live evidence contradicts that. This is reported before any configuration change,
per the governing directive's rule that live evidence overrides the document, and per SA1's own
instructions not to invent callback paths or enable flows the product does not support.

### CarUp does not use Supabase Auth. At all.

| Evidence | Value |
|---|---|
| `supabase.auth.*` call sites in the entire repo | **0** |
| `auth.users` (Supabase Auth identities) | **0** |
| `auth.users` ever confirmed / ever signed in | **0 / 0** |
| `public.users` (CarUp's own table) | **75** (41 created in the last 30 days) |
| `public.user_sessions` (CarUp's own sessions) | **864** |
| `public.login_attempts` | **940** |
| `public.users` rows linked to an `auth.users` row | **0** |

Authentication is a **custom backend implementation**:

- `POST /api/auth/login` — `backend/server.js:1252`; bcrypt against `public.users.password_hash`,
  issues an opaque `sk_live_…` token persisted to `public.user_sessions`.
- `GET /api/auth/me` — `backend/server.js:1301`
- `POST /api/auth/register` — `backend/server.js:1328`
- `POST /api/auth/switch-role` — `backend/server.js:316`
- Authorization gate: `backend/middleware/authMiddleware.js` reads the `x-session-token` header and
  validates the `user_sessions` row. It is not a JWT and not GoTrue.
- `backend/db/supabase.js` sets `autoRefreshToken:false, persistSession:false` — Supabase is used
  purely as a PostgREST database driver.
- Frontend session state lives in `localStorage` (`carup_user` / `carup_token`), see
  `web/src/context/AuthContext.tsx`. The mobile app (`mobile/app/(auth)/`) calls the same custom
  endpoints.

### CarUp has no password reset or email confirmation — on any layer

This is a **feature gap**, not a competing implementation:

- No Supabase reset flow (Supabase Auth is unused).
- No custom reset flow either. A search for `reset_token|forgot|password_reset|verification_token|
  confirm_token` across `backend/routes/`, `backend/services/`, `backend/utils/` and `server.js`
  returned nothing relevant. There is no logout, reset, forgot, verify-email, resend-confirmation,
  change-password or change-email endpoint.
- `backend/utils/passwordAuth.js` does hashing/verification only — it issues no tokens.
- No invite flow exists (`backend/routes/adminRoutes.js` has no user creation or invitation).

### The router has no `/auth/*` namespace

Existing auth routes (`web/src/App.tsx:294-297`): `/login`, `/register`, `/verify-otp`, `/kyc`.

Missing — i.e. every route a Supabase Auth email would need to land on: `/auth/callback`,
`/auth/confirm`, `/auth/reset-password`, `/forgot-password`, `/verify-email`, `/invite`,
`/magic-link`. Anything emailed today would hit the catch-all `NotFoundPage` (`App.tsx:405`).

### Two product defects surfaced (reported, not silently fixed)

1. **Dead "Forgot password?" link** — `web/src/pages/auth/Login.tsx:197` renders
   `<Link to="#">Forgot password?</Link>`. The UI advertises a capability that does not exist
   anywhere in the product. Fixing it requires deciding *where* it should go, which depends on the
   architecture decision below.
2. **`/verify-otp` is a placebo** — `web/src/pages/auth/OTPVerification.tsx:24-30` accepts any six
   digits via `setTimeout`, shows "Phone number verified!" and redirects to `/kyc`. No network
   call, no verification, no backend. It is phone-framed, not email.

Also corrected in this commit: `web/src/lib/supabase.ts` claimed the browser client was used for
"Auth flows (Supabase Auth)". That was never true and is now documented accurately, including the
latent `detectSessionInUrl:true` hazard should Supabase Auth ever be adopted.

---

## What SA1 would and would not achieve, as specified

Configuring Supabase Auth custom SMTP + branded Supabase templates today would produce **correct,
working infrastructure that sends zero Email to zero users**, because nothing in CarUp ever invokes
GoTrue. It would not give CarUp a password reset, because CarUp has no reset flow to email about.

Specifically, these SA1 acceptance criteria **cannot** be met as written:

- **SA1.7.A** "signup/confirmation Email → real inbox → successful confirmation" — CarUp's
  `POST /api/auth/register` never triggers a Supabase signup email, and there is no confirm route.
- **SA1.7.B** "password recovery Email → CarUp-owned reset route → successful password reset" —
  there is no password recovery flow and no reset route in the product.
- **SA1.6** "password recovery returns to the correct CarUp route", "invite flow works where used",
  "magic link/OTP works where used" — none of these flows exist to be verified.

---

## The decision required (owner)

**Path A — build auth Email on CarUp's existing custom auth.** Add a reset/confirmation token
store and endpoints to the current backend, add `/auth/confirm` and `/auth/reset-password` routes,
and deliver through the CarUp Communications stack this branch is already building (Resend
transport, canonical-origin links, quota governance). Supabase Auth stays dormant. No auth
migration, no risk to the 75 existing users, and it fixes the real gap (no password reset).

**Path B — migrate CarUp to Supabase Auth, then brand its templates.** Re-platform login for 75
users and 864 sessions: rewrite `authMiddleware.js`, `AuthContext.tsx`, both mobile auth screens,
and every test that mocks `user_sessions`; backfill `auth.users`; then SA1 as specified becomes
meaningful. Substantially larger, and it touches the live authentication path.

Path A is the recommendation: it fixes the actual user-facing gap, matches the architecture already
in flight on this PR, and does not put the working login path of a live product at risk.

---

## Delivered in SA1 regardless of the decision (fork-independent)

These were built because they are correct under **either** path — Supabase template configuration
or CarUp Communications rendering.

### Branded authentication Email design system
`backend/services/communication/authEmailTemplates.js`

- Six authentication templates: confirm signup, invite user, magic link/OTP, change email address,
  reset password, reauthentication.
- Five account-security notifications: password changed, email changed, phone changed, MFA method
  added, MFA method removed.
- **Unreconciled capabilities are `enabledByDefault:false`** — phone change and both MFA
  notifications are explicitly marked `NOT reconciled`, because CarUp has no phone-auth or MFA
  enrolment flow. SA1.3 forbids enabling a security flow the product does not support.
- Transport-neutral: Supabase template variables (`{{ .TokenHash }}`, `{{ .Token }}`,
  `{{ .Email }}`, `{{ .NewEmail }}`) are preserved verbatim, so the same definitions serve either path.
- Design: white surface, deep-navy `#0F172A` headings, 600px max width, mobile-safe, no marketing
  copy, action link repeated as copyable plain text.
- **Accessibility deviation, deliberate:** the action colour is `#C2410C`, not the UI's `#F97316`.
  White text on `#F97316` is ≈2.9:1 and fails WCAG AA; `#C2410C` reaches ≈5.2:1 while still reading
  as CarUp orange. Authentication Email is the wrong place to trade legibility for saturation. The
  ratio is asserted at test time, not assumed.

### Canonical link governance (SA1.2)
Links are built by `buildAuthActionUrl()` on top of the existing `resolveCanonicalWebOrigin()`
governance — reusing the module added for the share-origin fix rather than adding a competing
system. Consequences, all test-enforced:

- production links → `https://carup.dev/auth/confirm?...`
- staging links → `https://staging.carup.dev/auth/confirm?...`
- never `*.vercel.app`, never `project-ref.supabase.co`
- `{{ .ConfirmationURL }}` is **not** used, because it resolves to the raw Supabase host and would
  make Supabase infrastructure the durable, forwardable identity in a user's inbox
- a hostile `CARUP_PUBLIC_WEB_URL` cannot move the link origin off the CarUp domain family

> `/auth/confirm` is **parameterised, not invented**: `AUTH_CONFIRM_PATH` is configurable and the
> route does not exist in the frontend yet. It must be built before any template linking to it is
> activated.

### Free-tier budget integration (SA1.5)
`backend/config/emailProviderQuota.js` now encodes the priority ladder:

```text
P0 auth / account security   ← never deferred
P1 conversational
P2 transactional
P3 service
P4 marketing (Brevo only)    ← suppressed first
```

**Honest limitation, documented rather than papered over:** under plain SMTP, Supabase Auth sends
leave Supabase's infrastructure directly and do **not** pass through CarUp's quota module, so exact
cross-system pre-send accounting is impossible. Until a Send Email Hook routes Auth Email through
CarUp's queue, the controls are Supabase Auth's own rate limit, Resend lifecycle evidence, and
CarUp operational alerts. CarUp's delivery worker must not be assumed to be the only consumer of
the Resend daily allocation — reserve headroom accordingly.

### Future option (explicitly not SA1)
```text
Supabase Send Email Hook → CarUp Communications → Resend
```
This is the upgrade that unifies pre-send governance, letting every Auth Email enter CarUp's queue,
quota and audit before provider send. Recorded as a Phase-2 option; not implemented in SA1, and not
required unless live evidence shows custom SMTP cannot satisfy an acceptance criterion.

---

## Not done (blocked or deliberately deferred)

- **Supabase Auth custom SMTP configuration** — requires the Management API or dashboard. The
  Supabase CLI here is unauthenticated (no PAT) and the MCP server exposes only database/functions
  tools, no auth-config surface. Owner action.
- **Applying templates to Supabase** — same access gate, and contingent on the Path A/B decision.
- **SA1.7 physical proof** — cannot be performed against flows that do not exist. Under Path A it
  becomes provable once the reset/confirm endpoints and routes are built.
- **The dead "Forgot password?" link and the placebo `/verify-otp`** — reported above; both need a
  product decision, and `/verify-otp` in particular should not be quietly wired to a real flow
  without deciding whether phone verification is in scope at all.
- **No physical Email sent. No user population contacted. Production Communications remains
  INACTIVE.**
