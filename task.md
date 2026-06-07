# Tasks: Step 5 — Security Hardening & Abuse Protection

## Directive 009C - Secret Cleanup & High-Risk Endpoint Lockdown
- [x] Confirm whether root `.env` is tracked (verified not tracked).
- [x] Ensure `.gitignore` ignores all `.env` files and whitelists `.env.example`.
- [x] Create or update `.env.example` with safe placeholders.
- [x] Protect high-risk AI endpoints (`POST /api/ai/ocr`, `POST /api/ai/fraud-scan`, `POST /api/ai/risk-assessment`) with active session authentication checks in `backend/server.js`.
- [x] Add dynamic CORS whitelisting for local development, Vercel preview domains, and explicit production domains.
- [x] Append 6 dedicated backend integration tests to `backend/tests/run-tests.js` to validate blocked unauthenticated guests and allowed authenticated sessions for AI routes.
- [x] Resolve `res.getHeader` TypeError blocker in backend test suite runner mock.
- [x] Verify backend integration tests pass successfully (`npm test` - all 31 tests passed).
- [x] Verify Playwright E2E verification specs pass successfully (`tests/agents/16-trust-ocr.spec.ts` - all passed).
- [x] Verify TypeScript compilation passes successfully (`npx tsc --noEmit` - zero errors).
- [x] Verify monorepo production build succeeds (`npm run build` - successful build).
- [x] Compile final security cleanup report (`SECURITY_SECRET_CLEANUP_REPORT.md`).

## Directive 009D - Remove Hardcoded Migration Script Service Role Key
- [x] Inspect `scripts/migrate-to-supabase.js` and locate all hardcoded credentials and passwords.
- [x] Replace hardcoded URL, service role key, and database passwords with process.env values loaded via dotenv.
- [x] Integrate standard `ws` transport layer in dynamic createClient for Node.js 20 compatibility.
- [x] Add explicit startup validations ensuring the script cleanly crashes if SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_DB_URL is missing.
- [x] Add `SUPABASE_DB_URL` variable to `.env`, `backend/.env`, and `.env.example`.
- [x] Sanitize instructions and stdout prints so credentials and passwords are never printed to logs.
- [x] Verify migration execution successfully completes locally (`node scripts/migrate-to-supabase.js`).
- [x] Run grep assertions confirming no plaintext password or role key remains hardcoded.
- [x] Run complete verification suite (`npm test`, `npx tsc`, `npm run build`, Playwright E2E specs) ensuring zero regressions.
- [x] Compile security migration secret cleanup report (`SECURITY_MIGRATION_SECRET_CLEANUP_REPORT.md`).

## Security Hardening & Abuse Protection
- [x] Create `backend/middleware/securityMiddleware.js`
- [x] Implement production security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- [x] Implement CORS allowlist hardening with strict origin validation
- [x] Implement global sliding-window rate limiter (100 req/min)
- [x] Implement sensitive route sliding-window rate limiter (5 req/min) for auth, uploads, safepay creation
- [x] Implement signed CSRF double-submit token generator and validator bound to user/session context
- [x] Update `backend/server.js` to mount security headers, CORS hardening, global rate limiter, and CSRF endpoint/middleware
- [x] Modify `backend/services/storage/mediaRouter.js`
- [x] Implement upload size limit (max 10MB)
- [x] Implement MIME spoofing verification checking PDF, JPEG, PNG magic bytes
- [x] Implement malware scanning hook with EICAR signature and script injection checks
- [x] Implement scoped and audited signed upload URL generation endpoint (owners, dealers, admins only, strict bucket/paths, short expiry, audit log, size/type policy)
- [x] Modify `backend/services/payment/paymentRouter.js`
- [x] Implement anti-replay timestamp validation (max 5 minutes drift)
- [x] Recompute HMAC signature using timestamp + body payload validation
- [x] Modify `backend/middleware/authMiddleware.js`
- [x] Correct HTTP status code response mapping (forward custom status codes like 403 instead of converting to 500)
- [x] Enforce strict session expiration check (`expires_at` validation)
- [x] Update `backend/tests/run-tests.js`
- [x] Fix Test 21 telemetry check by seeding a temporary bank user `u_test_bank_telemetry`
- [x] Create Test 35 covering security headers, rate limiting, anti-replay webhooks, magic bytes, malware scanning, signed CSRF, and signed upload URLs
- [x] Run integration tests: `node backend/tests/run-tests.js`
- [x] Run E2E tests: `npx playwright test`
- [x] Run TypeScript checks: `npx tsc --noEmit --project web/tsconfig.app.json`
- [x] Build Vite app: `npm run build`
- [x] Update `walkthrough.md` with execution summary and screenshots/results
