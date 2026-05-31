# CarUp Kimi — Native Migration Execution Directive

## Phase Governance Instructions for All Agents

This directive supersedes all generalized assumptions.

All agents must operate under the following constraints while implementing the CarUp Kimi Native Mobile Migration and Device Features architecture.

---

# 1. Primary Mission

The objective is NOT merely to create a mobile app.

The objective is to:
* preserve the active production-grade web platform,
* introduce a fully isolated native mobile runtime,
* centralize business logic into a shared cross-platform domain layer,
* maintain backend API continuity,
* avoid regressions in escrow, KYC, trust graph, OCR, and vehicle systems,
* and establish a scalable monorepo architecture capable of future expansion into:
  * dealer apps,
  * inspector apps,
  * logistics apps,
  * admin moderation apps,
  * AI field-agent tooling,
  * and offline-first mobile verification systems.

Agents must optimize for:
* reliability,
* maintainability,
* security,
* observability,
* and production resilience.

NOT speed.

---

# 2. Mandatory Repository Governance

Agents MUST implement the repository using this enforced structure:

```text
carup-kimi/
├── web/
├── mobile/
├── shared/
├── backend/
├── database/
├── docs/
├── scripts/
└── .github/
```

Agents are forbidden from:
* mixing mobile code into `/web`,
* duplicating validation schemas,
* duplicating business calculations,
* creating separate API logic for mobile/web unless platform constraints require it.

---

# 3. Shared Layer Governance

The `/shared` layer is now the canonical domain engine.

Agents MUST migrate and centralize:

### Shared Types
* AuthUser
* Vehicle
* Escrow
* InspectionReport
* OCRDocument
* TrustGraphNode
* Notification
* RolePermissions

### Shared Validators
Use:
* `zod`
* platform-agnostic validation only

### Shared Business Rules
Examples:
* escrow fee calculations
* ZIMRA duty estimators
* VIN validators
* odometer anomaly detection
* verification score weighting
* AI trust scoring
* KYC parsing transforms

---

# 4. Backend Compatibility Rules

Agents MUST preserve compatibility with the current Express backend.

No destructive API rewrites are permitted.

### Existing API Contracts Are Protected
The following systems are considered production-sensitive:
* authentication
* escrow
* media uploads
* OCR
* SafePay
* trust graph
* notifications
* admin moderation

Agents MUST:
* extend endpoints,
* never silently mutate contracts,
* never break existing frontend payload expectations.

---

# 5. Mobile Authentication Architecture

Agents MUST NOT reuse React Context authentication from web.

Mobile authentication must use:
* Zustand
* Expo SecureStore
* token hydration middleware
* persistent auth restoration
* automatic token refresh interceptor

Mandatory stack:
```text
zustand
expo-secure-store
react-query
```

Web auth and mobile auth are separate runtimes.
Only the API contract is shared.

---

# 6. API Client Refactor Requirements

Current `useCarUpApi.ts` coupling is prohibited.

Agents MUST refactor into:
```text
shared/api/client.ts
```

The client MUST support:
* dynamic token injection,
* refresh handlers,
* request retries,
* offline queuing,
* timeout handling,
* structured API errors,
* upload progress events.

Agents MUST ensure:
* zero React dependency,
* zero browser-only APIs,
* zero Expo-only APIs inside shared.

---

# 7. Offline Architecture Rules

For offline persistence:

APPROVED:
* Expo SQLite

REJECTED:
* Realm
* WatermelonDB
* AsyncStorage-only persistence

Reason:
* deterministic schema management,
* lightweight footprint,
* Expo compatibility,
* easier CI validation.

Agents MUST prepare offline tables for:
* draft vehicle listings,
* cached inspections,
* pending uploads,
* queued escrow actions,
* OCR staging,
* trust graph sync snapshots.

---

# 8. Camera & OCR System Rules

Agents MUST implement real native capture flows.

Mock scanners are prohibited.

Approved capture stack:
```text
expo-image-picker
expo-camera (future expansion)
expo-file-system
```

Current approved transport strategy:

# Approved Strategy
Base64 upload compatibility.

Reason:
* existing Express parser stability,
* zero backend regression risk,
* safer rollout.

Agents MUST:
### Compress images before upload
Target:
```text
< 500KB
```

### Enforce:
* MIME validation
* orientation correction
* upload retry handling
* network timeout recovery
* upload cancellation

---

# 9. OCR Pipeline Rules

OCR processing is NOT merely image upload.

Agents must architect for:
```text
Capture
→ Compression
→ Validation
→ Upload
→ OCR Parse
→ Confidence Scoring
→ Verification Pipeline
→ Trust Graph Update
→ Fraud Detection
```

OCR results MUST support:
* Zimbabwe IDs
* passports
* vehicle registration books
* ZIMRA documents
* invoices
* inspection forms

---

# 10. Trust & Fraud Architecture

Agents MUST preserve compatibility with:
* Trust Graph Engine
* AI anomaly systems
* Partsentry
* escrow fraud scoring
* verification scoring

All uploaded documents MUST include:
* hash tracking
* upload metadata
* device metadata
* timestamp integrity
* user linkage

---

# 11. Mobile Security Requirements

Mandatory security enforcement:

### Required
* SecureStore token storage
* HTTPS-only networking
* SSL pinning preparation hooks
* biometric-ready auth architecture
* anti-token leakage logging rules
* upload MIME verification
* image metadata sanitization

### Forbidden
* plaintext token storage
* AsyncStorage auth tokens
* console logging secrets
* raw OCR dumps in logs

---

# 12. Expo & Native Runtime Governance

Agents MUST use:
```text
Expo SDK latest stable
Expo Router
NativeWind v4
```

Agents MUST prepare for future EAS builds.

Mandatory:
* iOS compatibility
* Android API 34+
* Hermes enabled
* Metro monorepo resolution
* production environment separation

---

# 13. CI/CD Requirements

Agents MUST ensure:

### Root Commands Continue Working
```bash
npm run dev
npm run build
npm run test
```

### CI Must Validate
* web build
* mobile typecheck
* backend build
* shared compilation
* Playwright
* ESLint
* schema integrity
* monorepo dependency graph

---

# 14. Playwright Governance

Web E2E tests are protected assets.

Agents MUST:
* preserve existing test discovery,
* preserve existing QA flows,
* remap configs safely after migration.

No test deletion permitted.

---

# 15. Observability & Telemetry

Agents MUST integrate:

### Required
* Sentry
* structured logging
* upload failure telemetry
* OCR confidence telemetry
* auth restoration telemetry

### Future-ready hooks
* analytics
* fraud metrics
* trust scoring metrics

---

# 16. Mobile Performance Constraints

Agents MUST optimize for low-end Android devices common in African markets.

Target constraints:
* low memory usage
* reduced JS thread blocking
* compressed uploads
* lazy route loading
* optimized image rendering
* FlashList virtualization

---

# 17. Platform Isolation Rules

The following are forbidden inside `/shared`:

### Forbidden
* React DOM
* Expo APIs
* browser window APIs
* document APIs
* localStorage
* SecureStore
* React hooks

`/shared` must remain platform-neutral.

---

# 18. Deployment Sequencing

Agents MUST execute in this order:

### Phase 1
Monorepo restructuring

### Phase 2
Shared extraction

### Phase 3
Web stabilization verification

### Phase 4
Mobile runtime bootstrap

### Phase 5
Authentication integration

### Phase 6
API client migration

### Phase 7
Camera + OCR systems

### Phase 8
Offline sync layer

### Phase 9
Telemetry integration

### Phase 10
Production hardening

No skipping permitted.

---

# 19. Mandatory Testing Gates

Agents MUST NOT mark tasks complete without:

### Required
* TypeScript clean compile
* ESLint clean
* Playwright pass
* mobile runtime verification
* OCR upload verification
* authentication persistence verification
* API regression verification

---

# 20. Final Architectural Principle

CarUp Kimi is NOT a simple classifieds app.

Agents must treat the platform as:
```text
A trust-driven automotive operating system
with escrow,
identity verification,
fraud intelligence,
AI-assisted inspections,
and multi-platform transactional infrastructure.
```

All engineering decisions must reinforce:
* trust,
* traceability,
* scalability,
* and resilience.

Do not optimize for shortcuts.

Optimize for long-term platform integrity.
