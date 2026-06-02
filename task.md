# Task List - Directive 009C: Secret Cleanup & High-Risk Endpoint Lockdown

- [x] Confirm whether root `.env` is tracked (verified not tracked).
- [x] Ensure `.gitignore` ignores all `.env` files and whitelists `.env.example`.
- [x] Create or update `.env.example` with safe placeholders.
- [x] Protect high-risk AI endpoints (`POST /api/ai/ocr`, `POST /api/ai/fraud-scan`, `POST /api/ai/risk-assessment`) with active session authentication checks in `backend/server.js`.
- [x] Add dynamic CORS whitelisting for local development, Vercel preview domains, and explicit production domains.
- [x] Append 6 dedicated backend integration tests to `backend/tests/run-tests.js` to validate blocked unauthenticated guests and allowed authenticated sessions for AI routes.
- [x] Resolve `res.getHeader` TypeError blocker in backend test suite runner mock.
- [x] Verify backend integration tests pass successfully (`npm test` - all 31 tests passed).
- [x] Verify Playwright E2E verification specs pass successfully (`tests/agents/16-trust-ocr.spec.ts` - all 3 passed).
- [x] Verify TypeScript compilation passes successfully (`npx tsc --noEmit` - zero errors).
- [x] Verify monorepo production build succeeds (`npm run build` - successful build).
- [x] Compile final security cleanup report (`SECURITY_SECRET_CLEANUP_REPORT.md`).
