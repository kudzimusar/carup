# CarUp OS — Security & Production Sanity Audit Master Report (Directive 009A)

This master report synthesizes our comprehensive security, boundary protection, secret exposure, and architectural safety checks. It maps risk classifications, highlights CORS and Supabase RLS gaps, provides a prioritized fix roadmap, and states our security opinion on the resumption of feature development.

---

## 1. Mapped Production Risks & Severity

### Critical Risks (Immediate Remediation Required)
1. **Unprotected Vehicle Status Moderation (`PATCH /api/vehicles/:vin/status`)**:
   * **Finding**: The status PATCH endpoint does not use authentication or role authorization middleware. Anyone can suspend, ban, or restore listing visibilities on the marketplace.
   * **Impact**: Direct marketplace bypass. High risk of malicious listing suppression.
2. **Unauthenticated Role Switching (`POST /api/auth/switch-role`)**:
   * **Finding**: Switch-role accepts any arbitrary `userId` and stakeholder role parameter without verifying if the request comes from the owner of that account. It creates and returns a valid session token directly.
   * **Impact**: Total administrative/user context takeover by simple ID guessing.
3. **Public B2B Audit Logs (`GET/POST /api/organizations/:id/audit-logs`)**:
   * **Finding**: B2B audit logs can be retrieved and injected by any unauthenticated guest. 
   * **Impact**: Injection of spoofed actions and exposure of sensitive operational changes.

### High Risks (Short-Term Remediation Required)
1. **Unprotected AI Computational Billing Endpoints (`/api/ai/ocr`, `/api/ai/fraud-scan`, `/api/ai/risk-assessment`)**:
   * **Finding**: Publicly accessible without session validation.
   * **Impact**: Exposed to denial-of-billing attacks that deplete Gemini/Groq quotas and raise massive cloud costs.
2. **Committed Local Secrets in Root `.env`**:
   * **Finding**: Real active environment variables (`GEMINI_API_KEY`, Supabase credentials) are checked into the main repository.
   * **Impact**: Immediate secret exposure if the main repository is ever pushed to public staging (e.g. GitHub public).

### Medium Risks (Remediation Encouraged)
1. **Open Wildcard CORS (`app.use(cors())`)**:
   * **Finding**: Express uses empty `cors()` which defaults to wildcard `Access-Control-Allow-Origin: *` for all routes.
   * **Impact**: Exposed to credential boundary anomalies in browser contexts.
2. **Unprotected Fleet Vehicle Reservations (`POST /api/vehicles/:vin/reserve`)**:
   * **Finding**: Public vehicle locking without token context.
3. **Exposed B2B Directories (`/api/organizations/:id/users`, `branches`)**:
   * **Finding**: Directory structures are readable without B2B session contexts.
4. **Client-Side Protected Route Guard Gaps**:
   * **Finding**: `DashboardLayout` allows page renderings without active sessions. (Guarded via backend API failures only).

### Low / Negligible Risks (Safe)
1. **Secret Leakage in Production Error Payload**:
   * **Verification**: The central error handler (`errorHandler`) properly uses environment toggles to strip detailed stack traces and debugging logs, preventing data leakage in production.
2. **Audit Redaction & Correlation**:
   * **Verification**: The centralized audit logger recursively redacts private keys. Correlation IDs match correctly across routing.

---

## 2. CORS, Headers & Supabase RLS Profile

### CORS & Security Headers
* **CORS**: Currently set to unrestricted wildcard access (`*`). In production, this must be locked down to verified client origins (e.g., `https://carup.co` or specific dashboard subdomains).
* **Headers**: Security headers (e.g., `Helmet` integration for CSP, X-Frame-Options, HSTS, X-Content-Type-Options) are missing in `server.js` and should be registered early in the middleware stack.

### Supabase & RLS (Row-Level Security)
* **RLS Bypassing**: The backend service initialization (`supabase.js`) intentionally runs in `service_role` (admin bypass) mode. This is secure *only because it remains confined to the server-side Node container*.
* **Database Guarding**: Database tables themselves should enforce strict RLS policies on Supabase directly to block anonymous REST API overrides from the web client.

---

## 3. Recommended Remediation Order & Roadmap

To establish a production-hardened release, we recommend the following prioritized fix order:

### Phase 1: Critical Ingress Guards (Immediate)
1. **Guard switch-role**: Add active session checks to `POST /api/auth/switch-role` to verify that the requestor owns the user record.
2. **Guard vehicle status**: Register `authorizeRole(['admin', 'dealer', 'owner'])` on `PATCH /api/vehicles/:vin/status` and add ownership mapping check.
3. **Guard B2B Audit Logs**: Bind organizational routes under token authentication, ensuring users can only read/write logs belonging to their `tenantId`.

### Phase 2: Billing & Resource Limits (Short-term)
1. **Secure AI endpoints**: Bind `/api/ai/*` behind standard `authorizeRole()` middleware to stop guest billing exhaustion.
2. **Git Secrets Scrubbing**: Remove `.env` from git tracking, add to `.gitignore`, and rotate the Gemini/Groq keys immediately.

### Phase 3: Monorepo Hardening (Medium-term)
1. **CORS Lock down**: Restrict CORS to configured environment hosts.
2. **Register Helmet**: Add standard security header middleware.
3. **Client-Side guards**: Add immediate `useEffect` authentication redirects inside the frontend `DashboardLayout.tsx` to handle unauthenticated sessions.

---

## 4. Security Opinion: Safe to Resume Feature Development?

> [!IMPORTANT]
> **Antigravity AI Security Verdict: UNSAFE TO RESUME FEATURE DEVELOPMENT.**
>
> While the trust-scoring calculations and E2E specs are highly robust and fully validated, the **Critical Gaps in route authentication (role switching, vehicle status updates, and public B2B log read/write)** present significant operational and security vulnerabilities. 
> 
> Returning to feature development before these boundary gaps are resolved creates substantial technical debt and security exposure. **We highly recommend a brief, targeted remediation sprint to secure these endpoints before introducing new features.**

---
**Audit compiled by Antigravity AI.**  
*Status: Security boundaries cataloged. Remediations recommended before feature sprint.*
