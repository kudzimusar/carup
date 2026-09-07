# Cross-System Authority Audit Register

Produced by a 79-agent read-only audit over the #194 authority. **70 candidate findings
were raised; each was then handed to an independent agent instructed to REFUTE it.**
**30 survived refutation; 40 were refuted and are excluded.**

Refuted findings are not listed as risks. Several were textually accurate but described
unreachable consequences — dead code shadowed by a fail-closed 410, grants already revoked,
or files that do not exist at the audited SHA. Reporting them would have been noise.

**Not one confirmed finding is Seller-owned.** The audit respected the exclusion boundary.

Severity is the auditor's; `Status` is this cycle's disposition.


## Disposition summary

Counts below are as of the V16 convergence (PR #194 head `55c2f894`). The non-Seller hardening
cycle that produced this register closed 6 and mitigated 1; the convergence closed a further 6
and mitigated 2 more.

| Status | Count | Meaning |
|---|---|---|
| CLOSED | 13 | fixed, each with a regression test |
| MITIGATED | 3 | the exploitable reach is closed; a named residual remains, recorded per finding |
| OPEN | 15 | precisely located, not fixed — see the scope note below |

**31, not 30.** The convergence's own SJO-4 audit surfaced one finding the original 79-agent audit
did not: a failed marketplace evidence/PartSentry/ownership read published as a governed negative.
It is recorded in P2 with its disposition rather than folded silently into the original count.

### What the V16 convergence closed

Every P0 and every P1 that was reachable and bounded:

| Finding | Now |
|---|---|
| P0 — any registered user could flag any VIN stolen, irreversibly | CLOSED |
| P1 — finance/lender routes authorized by role only; consent unbound | CLOSED |
| P1 — insurer/eligibility routes, same gap, including the read path | CLOSED |
| P1 — an unauthenticated GET persisted a dealer trust score | CLOSED |
| P1 — the odometer-reversal detector was dead by construction | CLOSED |
| P1 — any authenticated user could drive a diaspora trust score to 0 or 100 | CLOSED |
| P1 — mechanic odometer write reached every VIN (two findings, one root cause) | MITIGATED — reach closed, irreversibility recorded |

**Why 15 remain open.** The mandate was to fix what is bounded and safe to remediate now, not
to broaden into unrelated feature work. The remaining items are overwhelmingly pre-existing
`main` defects rather than #194 convergence defects, and several (the parallel diaspora trust
engines, the odometer authority fragmentation, the JS/SQL transfer state-machine duplication)
are genuine architectural decisions that need an owner, not a patch. Each is located to file
and line here so the next lane starts from evidence.

**Two of the open items are NOT #194's to close.** The service-case saga rollback belongs to
`backend/services/serviceNetwork/`, which does not exist on this branch at all — it arrives with
PR #197, and is that lane's obligation. The `notification_queue` second-writer finding is a
Communications integration that would mean registering the DIASPORA_* event types and routing
milestones through `CommunicationProductNotificationService`; it is recorded here as a bounded
residual rather than attempted inside a convergence whose job was to join two frozen lanes.

**One finding fixed here does not appear above**, because the verifier refuted the finding as
stated while the underlying hazard was real: `masterSecret()` and `currentSystemSecret()` fell
back to `crypto.randomBytes` whenever `NODE_ENV === 'test'`. In a deployment mis-set that way
the ledger keeps accepting writes while every signature becomes unverifiable across instances
and restarts. Closed with the same deployment-environment conjunction.

---

## P0 (4)

### [CLOSED] Any self-registered user can flag any VIN as stolen; the reporter identity is client-supplied and there is no un-flag route

**Location:** `backend/server.js:1787`

**Evidence:** backend/server.js:1787 `app.post('/api/security/report-stolen', authorizeRole(['owner','government']), async (req,res) => { const { vin, policeReportNumber, ownerId } = req.body; ... await reportVehicleStolen(vin, policeReportNumber, ownerId)`. There is NO check that the caller owns `vin`. backend/server.js:2141-2157 shows public registration accepts only role 'owner' and every public account is created as 'owner' (`"Public registration cannot assign a role; accounts are created as 'owner'."`), so `authorizeRole(['owner','government'])` admits every registered user. The service then writes vehicle state unconditionally: backend/services/security/securityService.js:13-16 upserts `stolen_vehicles` with `reporting_owner_id: reportingOwnerId` taken verbatim from the body, and line 22 `await supabase.from('vehicles').update({ police_verified: false, status: 'Flagged' }).eq('vin', vin)`, then appends a permanent 'Stolen Vehicle Flagged' hash-chain event. `clearStolenStatus` (securityService.js:56) is exported but grep over backend (excluding tests) finds NO route mounting it — only `reportVehicleStolen` and `checkStolenStatus` are imported at backend/server.js:38.

**Required behaviour:** Gate the route on a verified relationship to the VIN (owner_id / current_seller_id / tenant scope) or restrict it to role 'government'/platform-admin, and derive the reporter from `req.userContext.id` instead of `req.body.ownerId`. Add a governed clear/appeal route (or mount `clearStolenStatus` behind government/admin authority) so the flag is not a one-way, unauthenticated-in-practice takedown of any listing.


**Disposition (V16 convergence, c260c3bb):** CLOSED. The route is now `authorizeSessionRole(['owner','government'])` plus `requireVehicleObjectAuthority()`, so a takedown needs a PROVEN session and a verified relationship to the vin; government and platform admins keep platform-wide authority. The reporter is `req.userContext.id` and `ownerId` is no longer read from the body. `POST /api/security/clear-stolen` mounts the existing `clearStolenStatus` behind `authorizeSessionRole(['government'])`, so the flag is reversible. Regression tests: `backend/tests/v16-authority-hardening.test.js` (section 2).

### [CLOSED] Unauthenticated OCR approval endpoint is a second vehicle trust + registry authority

**Location:** `backend/services/document-intelligence/documentIntelligenceRouter.js:42`

**Evidence:** `router.post('/ocr/:id/approve', async (req, res) => { const { actorId, vin, overrideJustification } = req.body; ... await DocumentIntelligenceService.approveDocumentVerification(id, actorId, vin, overrideJustification)`. The file contains ZERO `authorizeRole`/`requireProvenIdentity` (grep for them exits 1 over all 115 lines), and it is mounted bare at backend/server.js:300 `app.use('/api/verification', documentIntelligenceRouter);` with no auth middleware between it and `app.use(csrfMiddleware)` at server.js:220. CSRF is not a barrier: `GET /api/security/csrf-token` (backend/server.js:223-234) issues a token bound to `('guest','none')` to a caller with no headers, and csrfMiddleware (backend/middleware/securityMiddleware.js:230-245) validates against exactly `req.headers['x-user-id'] || 'guest'` and `'none'`. The handler chain then writes, in backend/services/document-intelligence/documentIntelligenceService.js: a forged `cvr_ownership_records` row (line 356) or `zimra_declarations` row (line 368), an `administrative_overrides` row whose `actor_id` is the caller-supplied `actorId` (line 384-395), `ocr_documents.status='Verified'` (line 397), and `vehicles.update({ trust_score: Math.min(100, (vehicle.trust_score||80)+20), status: 'Available', ...UNSTAMPED_TRUST_CACHE })` (lines 400-410). `ocrDoc` is fetched by id at line 310-318 and is NEVER checked to belong to the body-supplied `vin`. The prerequisite ocr_documents row is obtainable from the sibling unauthenticated `POST /api/verification/ocr` (router line 9), which persists a row at documentIntelligenceService.js:152-162 and returns its id as `ocrDocumentId` (line 213).

**Required behaviour:** Gate the whole router: `app.use('/api/verification', authorizeSessionRole(['admin','government']), documentIntelligenceRouter)` at backend/server.js:300, and inside `approveDocumentVerification` take the actor from `req.userContext.id` rather than `req.body.actorId` and assert `ocrDoc` is linked to the supplied `vin` before writing any registry row. The trust write should be replaced by `refreshCanonicalTrust(vin)` so the approval re-materialises through the single canonical writer instead of stamping a +20 over a fabricated 80 baseline.

**O2-X1 addendum (2026-09-03):** the residual half ("route through `refreshCanonicalTrust`") is closed by RETIREMENT rather than rerouting: `approveDocumentVerification` is deleted outright, along with the whole `/api/verification` router, its mount and its path-scoped rate-limit line — there is no approval write left to re-materialise. Registry rows (`cvr_ownership_records`/`zimra_declarations`) now have ZERO in-product writers. Pinned by `backend/tests/o2-x1-document-intelligence-authority.test.js`, the retirement test in `issue164-phase3-trust-authority.test.js` §11, and the B7 writer-set pin in `v16-authority-hardening.test.js` (now two writers).

### [CLOSED] Unauthenticated /api/verification/promote-trust sets any user's verification level from the request body

**Location:** `backend/services/document-intelligence/documentIntelligenceRouter.js:100`

**Evidence:** `router.post('/promote-trust', async (req, res) => { const { userId, trustLevel, details } = req.body; ... await TrustService.assignTrustLevel(userId, trustLevel, details || {})`. No auth on the route or the router (same mount as above, backend/server.js:300). `assignTrustLevel` (backend/services/trust-service/trustService.js:17-46) resolves `TRUST_LEVELS[level]` (0..5, 5 = 'Dealer Certified') and upserts `kyc_profiles` with `overall_status: 'Level_${level}_${stringLevel}'`, then writes a `security_events` 'TRUST_LEVEL_UPGRADE' row and a `trust_score_history` row with `new_score: (level+1)*20`. That same `kyc_profiles.overall_status` is read back as a verification signal at trustService.js:105-106 (`if (kyc?.overall_status?.includes('Biometric')) score += 25.0`). This is a second identity-verification-level authority that bypasses the governed one at backend/routes/identityVerificationAdminRoutes.js:39 (`authorizeRole(['admin'])` + `reviewVerificationSession`).

**Required behaviour:** Delete this route, or gate it with `authorizeSessionRole(['admin'])` and route the decision through `reviewVerificationSession` in backend/services/identity/verificationSessionService.js so verification level has one writer. `trustLevel` must never be read from the body without a reviewer identity and an audited decision record.

**O2-X1 addendum (2026-09-03):** resolved by the first option — the route AND `TrustService` are deleted (`assignTrustLevel`, `calculateUserTrustScore`, the six-tier vocabulary). The X1 caller survey found no consumer outside the retired router, and the only reader of `kyc_profiles.overall_status` was `calculateUserTrustScore` itself — a loop closed entirely inside the retired surface. Historical `kyc_profiles` / `trust_score_history` / `security_events` rows are preserved as data; no new rows of these kinds can be produced. Identity verification level now has exactly one writer (`reviewVerificationSession`). Pinned by `backend/tests/o2-x1-document-intelligence-authority.test.js`.

### [CLOSED] Diaspora ledger writer signs with the retired hardcoded system HMAC secret, permanently breaking passport chain verification for every handed-off VIN

**Location:** `backend/services/diaspora/diasporaOwnershipHandoffService.js:240`

**Evidence:** Line 240-241, 252: `const hmac = crypto.createHmac('sha256', 'carup-system-secret'); hmac.update(currentHash);` … persisted as `signature: `system:${hmac.digest('hex')}``. Issue #158 retired this literal: `currentSystemSecret()` in backend/services/blockchain/blockchainKeyCustodyService.js:115-123 reads `process.env.CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET` and throws without it, and `verifySystemLedgerHash` (same file, line 129) accepts ONLY that secret plus the comma-separated `CARUP_BLOCKCHAIN_LEGACY_SYSTEM_HMAC_SECRETS` list. `grep -rn carup-system-secret` over the whole repo returns exactly three hits: this line, and backend/tests/issue-158-private-key-custody.test.js:122-123, which assert `assert.doesNotMatch(runtime, /carup-system-secret/i)` for blockchainService.js and blockchainKeyCustodyService.js ONLY — the diaspora file is not covered, so the guard does not see it. No .env/.example/workflow/docs file in the repo registers the literal as a legacy secret. Because the row is written with signerId `system`, verifyChain routes it to the system branch at backend/services/blockchain/blockchainService.js:652-659 and returns `{verified:false, reason: 'System HMAC signature mismatch. Event ${e.id} failed.'}`. The payload (lines 408-418) is plain JSON, so the hash link verifies — the failure is isolated to, and guaranteed at, the signature check. The ledger is append-only, so the VIN's passport is unverifiable from that event onward, permanently. Live path: backend/routes/diasporaRoutes.js:148 -> completeOwnershipHandoff (line 320) -> line 422 -> appendHandoffTimelineEvent, with resolveClient returning the real service-role supabase singleton (backend/services/diaspora/diasporaServiceUtils.js:12-16). backend/tests/diaspora-ownership-handoff.test.js has zero matches for 'signature' or 'verifyChain', so this is entirely untested.

**Required behaviour:** Delete the inline HMAC and route the write through `blockchainService.addEvent(vin, HANDOFF_EVENT_TYPE, provenance, 'SYSTEM_SIGNATURE', { operationId: `diaspora_handoff:${importOrderId}` })`, which signs via `signSystemLedgerHash` and therefore uses the configured secret. If the injected-client seam must be kept for tests, inject the signer rather than re-deriving it, and never the secret. Separately, broaden the assertion at issue-158-private-key-custody.test.js:119-126 from two named files to a repo-wide scan of backend/ so no future copy can reintroduce the literal. Do NOT 'fix' this by adding 'carup-system-secret' to CARUP_BLOCKCHAIN_LEGACY_SYSTEM_HMAC_SECRETS — the value is public in git history, and admitting it would make every system-signed ledger event forgeable by anyone who can write the table.


## P1 (11)

### [MITIGATED] Any mechanic account can permanently inflate any VIN's odometer, and no path exists to correct vehicles.mileage afterwards

**Location:** `backend/server.js:1667`

**Evidence:** backend/server.js:1660 `app.post('/api/partsentry/add', authorizeRole(['mechanic','owner','dealer','admin']), ...)`; the ownership scope check at backend/server.js:1667 is explicitly skipped for mechanics — `if (req.userContext.role !== 'mechanic' && req.userContext.role !== 'admin') { ...owner/tenant check... }` — so a mechanic passes straight to `addRepairLog(vin, ...)` at line 1680 for any VIN. backend/services/partsentry/partsentryService.js:70 then writes the canonical column: `await supabase.from('vehicles').update({ mileage: odometer }).eq('vin', vin);`. The only guard is monotonic (partsentryService.js:32 `if (vehicle && odometer < vehicle.mileage) throw ...`), so the value can only ever go UP. Enumerating every non-test writer of `vehicles.mileage`: backend/server.js:2527 (`mileage: submittedMileage`, insert-only — the re-listing path builds `reusableListingRow` at backend/server.js:2668-2691 and deliberately omits mileage), partsentryService.js:70, and backend/services/diaspora/diasporaOwnershipHandoffService.js:209 (insert-only). There is therefore no update path that can lower a mileage once inflated — not even for an admin.

**Required behaviour:** Scope the mechanic branch to a real work-order/assignment relationship for that VIN rather than allowing any mechanic to write any vehicle. Treat `partsentry_logs.mileage` as an observation and derive `vehicles.mileage` from the governed observation set, and add a governance-authored correction path (audited, reason-required) so a bad reading is repairable instead of permanent.


**Disposition (V16 convergence, 55c2f894):** MITIGATED — the AUTHORIZATION half is closed, the ARCHITECTURAL half is not. `POST /api/partsentry/add` no longer exempts the mechanic role wholesale: only platform-wide roles bypass, and a mechanic must now hold a tenant link to the vehicle or an assigned `mechanic_work_orders` row for that exact vin, failing closed on a lookup error. The "every VIN on the platform" exposure is therefore gone.

**Residual, deliberately left open:** `addRepairLog` still writes `vehicles.mileage` directly and the guard is still only monotonic, so a bad-but-authorised high reading is still permanent and still blocks that vehicle's later genuine logs. Treating `partsentry_logs.mileage` as an OBSERVATION and deriving the canonical value through a single odometer-resolution service — with an audited, reason-required correction path — is a design change that needs an owner, not a patch, and is out of scope for this convergence.

### [CLOSED] The odometer-reversal fraud detector reads a field the canonical evidence writer never populates, so it is dead by construction

**Location:** `backend/services/fraud/fraudEngine.js:390`

**Evidence:** backend/services/fraud/fraudEngine.js:383-395 `detectMileageAnomalies` builds its readings only from evidence metadata: `const meta = ev.metadata || {}; const raw = meta.odometer_km ?? meta.mileage_km ?? meta.odometer ?? meta.mileage; if (raw == null) continue;` and returns early at line 396 `if (readings.length < 2) return signals;`. But the canonical evidence writer stores the reading in COLUMNS, not metadata: backend/services/evidence/evidenceService.js:151-157 normalizes `payload.odometer_value ?? payload.odometerValue`, and buildEvidenceProvenanceColumns writes `odometer_value: normalized.odometerValue, odometer_unit: normalized.odometerUnit` at evidenceService.js:198-199, while `metadata` is only whatever the client happened to send (evidenceService.js:178). The client sends the column form: web/src/components/EvidenceUploadModal.tsx:255-256 `payload.odometer_value = parsed; payload.odometer_unit = odometerUnit`. Compounding it, fraudEngine's own loader does not even select the columns: backend/services/fraud/fraudEngine.js:111-115 selects `'id, vin, evidence_type, checksum, image_hash, verification_status, metadata, captured_at, created_at'`. So the `odometer_reversal` signal — the only mileage signal carrying `blocks_publication: true` (fraudEngine.js:409-419) — can never fire on CarUp-written evidence. The same loader also fails open: `if (error) return []` and `catch { return [] }` (fraudEngine.js:116-119) turn a read failure into 'no anomalies'. Other readers of the same fact use the column: backend/services/report/canonicalVehicleLifecycleService.js:235 `mileage: row.odometer_value` and backend/services/report/reportService.js:39.

**Required behaviour:** Add `odometer_value, odometer_unit` to the fraudEngine evidence select and read them first (keeping the metadata keys only as a legacy fallback), so the publication-blocking reversal check sees the readings the platform actually stores. Separately, make the loader distinguish 'no evidence' from 'could not read evidence' rather than returning [] on error.


**Disposition (V16 convergence, c260c3bb):** CLOSED. `loadEvidence` now selects `odometer_value, odometer_unit` and `detectMileageAnomalies` reads the column first, keeping the metadata keys as a legacy fallback; miles are normalised to km so a unit change cannot manufacture a reversal. `loadEvidence` also returns `null` on a read error instead of `[]`, and the evaluator surfaces a non-blocking `evidence_not_readable` signal, so "could not look" is no longer indistinguishable from "looked and found nothing". A BEHAVIOURAL test proves the reversal signal now fires on column-form evidence.

### [CLOSED] Unauthenticated GET /api/reputation/:dealerId persists a second-engine dealer trust score

**Location:** `backend/server.js:1808`

**Evidence:** `app.get('/api/reputation/:dealerId', async (req, res) => { const result = await calculateDealerReputation(dealerId); ... })` — no `authorizeRole`. `calculateDealerReputation` (backend/services/reputation/reputationService.js:3-27) is not a read: it computes a 75.0-baseline score (`let baseReputation = 75.0;` line 15) and WRITES it at line 23 `await supabase.from('stakeholder_profiles').update({ trust_score: finalScore }).eq('user_id', dealerId);`, then publishes a verification level to the anonymous caller: `verificationTier: finalScore >= 90.0 ? 'Diamond Certified Dealer' : 'Standard Verified'` (line 25). A dealer with zero escrows gets 75 -> 'Standard Verified' with no evidence behind it. That written column is consumed as authority elsewhere: backend/services/trust-service/trustEnforcementEngine.js:155 `const currentReputation = profile.trust_score;` drives `propagateStakeholderRisk`, which penalises every one of that seller's vehicles (line 185), and backend/services/insurance/insuranceService.js:8-9 prices premiums off it.

**Required behaviour:** Make the GET a pure read (return the stored value, never `.update()`), and gate the recompute behind an authenticated, role-checked POST. A GET that mutates a trust column means any crawler re-scores dealers.


**Disposition (V16 convergence, c260c3bb):** CLOSED. Split into `readDealerReputation` (pure read, no write) and `recalculateDealerReputation` (the single writer), the latter mounted at `POST /api/reputation/:dealerId/recalculate` behind `authorizeSessionRole(['admin','government'])`. The read distinguishes `unmeasured` from a score and returns a null tier for an unscored dealer, so the 75.0 baseline is no longer published as evidence.

### [CLOSED] Any authenticated user can drive a diaspora trade profile's trust_score to 0 or 100

**Location:** `backend/services/diaspora/diasporaReputationService.js:38`

**Evidence:** Route: backend/routes/diasporaRoutes.js:328 `router.post('/reputation', auth, ... createReputationRecord(req.body, req.userContext, req))` where `auth = authorizeRole()` (diasporaRoutes.js:34) — any authenticated role. `createReputationRecord` validates only `if (!payload.trade_profile_id || !payload.rating) throw ...` (line 6): no rating range check, no self-review guard, no proof the reviewer transacted with the profile, and `verification_status: payload.verification_status || 'PUBLISHED'` (line 17) is taken straight from the body. It then calls `recalculateTradeProfileReputation`, which at line 37-38 computes `const trustScore = Math.max(0, Math.min(100, 50 + ratingAverage * 10 - disputeCount * 5));` and writes `await supabase.from('diaspora_trade_profiles').update({ rating_average, dispute_count, trust_score: trustScore, ... })`. A single POST with `rating: 1000` clamps to 100; `rating: -1000` clamps to 0. This is a second trust-score authority with effectively no authority check.

**Required behaviour:** Validate `rating` to the intended 1..5 range, reject self-review (`reviewer_id === profile.user_id`), require a completed import order linking reviewer and profile, and make `verification_status` server-decided (always 'PENDING_REVIEW' on create) rather than body-supplied.


**Disposition (V16 convergence, 55c2f894):** CLOSED. `rating` must be 1..5; the reviewer is `req.userContext.id` and never `payload.reviewer_id`; self-review is refused; `verification_status` is server-decided (`PENDING_REVIEW`); and the review must cite a **COMPLETED** import order on which BOTH the reviewer and the reviewed profile appear in `diaspora_import_order_participants`. Every lookup fails closed. `recalculateTradeProfileReputation` now excludes `REMOVED` and `FLAGGED` records, so a moderated-away review stops moving the average.

### [OPEN] Second, ungoverned writer into the canonical notification_queue: queueDiasporaNotification bypasses CommunicationNotificationService

**Location:** `backend/services/diaspora/diasporaNotificationService.js:13`

**Evidence:** `queueDiasporaNotification` (lines 8-40) inserts straight into the canonical outbound queue with the raw Supabase client: `.from('notification_queue').insert({ recipient_id, type, title, message, read:false, metadata:{...metadata, importOrderId, channels} })`. It sets no `dedupe_key`, no `channel`, no `tenant_id`, no `thread_id`/`message_id`, and never calls the preference/consent layer. The rows ARE picked up by the canonical worker: `notification_queue.status` defaults to `'queued'` (database/migrations/20260623143000_omnichannel_communication_engine.sql:145,179) and `claim_due_communication_notifications` selects on `lower(status) IN ('queued','retry_scheduled')` with no channel or dedupe filter (database/migrations/20260624120000_communication_provider_runtime.sql:51). CommunicationDeliveryWorker then does `const channel = notification.channel || 'in_app'` (backend/services/communication/communicationDeliveryWorker.js:80), so the declared `channels: ['IN_APP','EMAIL_READY','SMS_READY','WHATSAPP_READY','PUSH_READY']` intent (line 57) is discarded and every diaspora milestone is dispatched to the in_app FakeCommunicationAdapter and marked sent. Because `dedupe_key` is NULL, the DB uniqueness guarantee does not apply — it is a PARTIAL index, `WHERE dedupe_key IS NOT NULL` (database/migrations/20260817180000_notification_dedupe_uniqueness.sql:18-20). The DIASPORA_* event types are also absent from COMMUNICATION_EVENT_TYPES (backend/services/communication/communicationEventListeners.js:6-48), so nothing re-enters the governed path. Live callers: diasporaImportOrderService.js:96,194,402; diasporaWorkflowService.js:131; diasporaDocumentService.js:81.

**Required behaviour:** Route diaspora milestones through the canonical path — emit the domain event only, register the DIASPORA_* types in COMMUNICATION_EVENT_TYPES, and let CommunicationProductNotificationService.queueNotification mint the row (dedupe_key, channel from preferences, tenant_id, thread linkage). If a direct insert must remain short-term, it must at minimum set an explicit `channel` and a deterministic `dedupe_key` so the partial unique index actually protects it.

### [CLOSED] Finance/lender capability routes authorize by role only — no check that the caller has any relationship to :vin, and the consent ref is not bound to the vehicle or applicant

**Location:** `backend/routes/lenderRoutes.js:79`

**Evidence:** `router.post('/api/vehicles/:vin/finance/consent', authorizeRole(['owner','dealer','admin']), ...)` (line 79) and `router.post('/api/vehicles/:vin/finance/lender/eligibility', authorizeRole(['owner','dealer','admin']), ...)` (line 92) both mutate state for an arbitrary path VIN with no object-level check. The intended contract exists in the same file — `async function ownsVehicleOrPrivileged(req)` at line 37, documented 'a caller with the global owner role may only touch a VIN they actually own' — and is applied to exactly one route, the GET at line 126. Downstream the binding is also absent: `loadConsent` (backend/services/finance/lenderWorkflow.js:79-83) selects `finance_consents` by id alone, and `consentIsActive` (line 84-86) only checks revoked_at/deletion_requested_at — neither `consent.vin` nor `consent.applicant_user_id` is ever compared to the requested vin or `opts.requestedBy`. So any authenticated 'owner' can POST consent against a stranger's VIN, then POST eligibility, causing a real provider call via `executeProviderRequest` (lenderWorkflow.js:227) and persisted `eligibility_requests` / `finance_provider_decisions` rows; the route response returns `outcome`, `conditions`, `validity_until` and `provider_reference` directly (lenderRoutes.js:107-115), so the lender decision for a vehicle the caller does not own is disclosed.

**Required behaviour:** Call `ownsVehicleOrPrivileged(req)` at the top of both mutating handlers, exactly as the GET at line 126 does. In `requestLenderEligibility`, additionally reject a consent whose `vin !== vin` or whose `applicant_user_id !== opts.requestedBy` before treating it as satisfying the mandatory-consent gate.


**Disposition (V16 convergence, c260c3bb):** CLOSED. Both mutating routes now carry `requireVehicleObjectAuthority()` from the new `backend/middleware/vehicleObjectAuthority.js` — ONE definition of vehicle object authority, applying the same owner / current-seller / tenant rule `loadScopedVehicle` uses. The consent binding is closed separately by `consentBindsRequest`, which requires `consent.vin === vin` AND `consent.applicant_user_id === requestedBy` and fails closed when either is absent.

### [CLOSED] Insurer and generic eligibility routes have the same missing object-level authorization, including on the read path

**Location:** `backend/routes/insurerRoutes.js:104`

**Evidence:** `router.get('/api/vehicles/:vin/insurer/eligibility', authorizeRole(['owner','dealer','admin','reviewer']), ...)` calls `getInsurerStatus(req.params.vin)` with no ownership check; backend/services/insurance/insurerWorkflow.js:442-447 reads `eligibility_requests` and `insurance_provider_decisions` for that VIN and returns `publicProjection(...)`. The two mutating siblings are identical in shape: line 65 `POST /api/vehicles/:vin/insurer/consent` and line 82 `POST /api/vehicles/:vin/insurer/eligibility`, both `authorizeRole(['owner','dealer','admin'])` only. backend/routes/eligibilityRoutes.js:88-91 registers four more of the same family (`POST/GET /api/vehicles/:vin/insurance/eligibility`, `POST/GET /api/vehicles/:vin/finance/eligibility`) whose handlers (eligibilityRoutes.js:54-80) never read `req.userContext` for anything except `requestedBy`. Any authenticated user holding the 'owner' role can therefore request and read insurance/finance eligibility decisions for every VIN on the platform.

**Required behaviour:** Extract the `ownsVehicleOrPrivileged` helper from lenderRoutes.js:37 into one shared module and apply it as middleware to every `/api/vehicles/:vin/...` capability route in insurerRoutes.js and eligibilityRoutes.js, so vehicle-object authority is decided in one place rather than per route.


**Disposition (V16 convergence, c260c3bb):** CLOSED. The three insurer routes and the four eligibility routes all carry `requireVehicleObjectAuthority()`, decided in the one shared module rather than per route. The coarse PUBLIC finance availability endpoint is deliberately NOT gated, and a test pins that too — over-gating a documented public surface would be its own defect. A test asserts all NINE capability routes are covered.

### [MITIGATED] PartSentry: any effective-mechanic can irreversibly raise the canonical odometer of every VIN on the platform

**Location:** `backend/services/partsentry/partsentryService.js:70`

**Evidence:** `await supabase.from('vehicles').update({ mileage: odometer }).eq('vin', vin);` — the submitted reading overwrites the vehicle's canonical odometer. The only guard is monotonic (line 32: `if (vehicle && odometer < vehicle.mileage) throw`), so a value can be raised without bound and can never be lowered again through any product path (grep for writers of vehicles.mileage returns only this line and backend/services/document-intelligence/documentIntelligenceService.js:406, which does not touch mileage). The calling route at backend/server.js:1662 exempts mechanics from every relationship check: line 1666 reads `if (req.userContext.role !== 'mechanic' && req.userContext.role !== 'admin')` before the owner/tenant lookup, so a mechanic never reaches it. `req.userContext.role` is the EFFECTIVE role, and backend/middleware/authMiddleware.js:78-80 grants a requested role whenever it matches the caller's `tenant_users` role (`if (trustedTenantRole && requested === trustedTenantRole && requested !== 'admin') return requested;`) — so membership as 'mechanic' in any single tenant, asserted via x-stakeholder-role plus that tenant's x-tenant-id, confers platform-wide odometer write authority. The write also emits a signed ledger event (`addEvent(vin, 'Mechanic Inspection', ...)`, line 78) and feeds trust scoring.

**Required behaviour:** Require a relationship between mechanic and vehicle before the odometer write — an assigned work order, a tenant link, or an owner-issued service authorization — rather than exempting the role wholesale at server.js:1666. Separately, stop letting a repair log mutate `vehicles.mileage` directly: record the reading on partsentry_logs and let a single odometer-resolution service publish the canonical value, so a bad high reading can be superseded instead of permanently blocking every later genuine log.


**Disposition (V16 convergence, 55c2f894):** MITIGATED. Same root cause and same fix as the odometer finding above — the effective-role exemption at the route is closed, so the reach is no longer platform-wide. The irreversibility of an authorised write is the same recorded residual.

### [OPEN] Compensating rollback in the service-case saga discards its own error and reports success unconditionally

**Location:** `backend/services/serviceNetwork/serviceCaseService.js:419`

**Evidence:** In transition(), the append-history retry failure path runs `await supabaseClient.from('service_cases').update(restore).eq('id', caseRow.id).eq('status', toStatus);` (:419-423) with NO destructuring of `{ error }` and no row-count check, then unconditionally throws `new DatabaseError(\`Transition rolled back: the case history could not be recorded (${retryError.message})\`)` (:424-426). Every other Supabase call in this same function checks its error (e.g. the guarded status UPDATE at :376-384 does `if (error) throw new DatabaseError(...)` and `if (!data) throw new ConflictError(...)`). If the compensating UPDATE errors or matches zero rows, the case is left in the NEW status with no history row — precisely the 'unreconstructable' state the :423-425 comment says the rollback exists to prevent — while the caller is told it was rolled back. This saga is #197's stand-in for #194's atomic SECURITY DEFINER RPC (acknowledged at :404-406), so its failure mode is the whole safety argument.

**Required behaviour:** Destructure the rollback result, and on error or zero rows affected throw a distinct error that states the case is in an inconsistent state (status advanced, history missing) with the case id, so it is recoverable by an operator instead of being reported as a clean rollback.

### [MITIGATED] x-user-id header grants full identity, including admin, whenever NODE_ENV is test/development/local — the exact misconfiguration that already occurred in a deployed staging environment

**Location:** `backend/middleware/authMiddleware.js:58`

**Evidence:** `export function isUserIdFallbackAllowed(env = process.env) { return env.CARUP_ALLOW_X_USER_ID_FALLBACK === 'true' || env.NODE_ENV === 'test' || env.NODE_ENV === 'development' || env.NODE_ENV === 'local'; }`. This gates the credential-free branch in authorizeRole (line 120-128): with no session token, `activeUserId = fallbackUserId` is taken straight from the `x-user-id` header, then line 134-140 loads that user's real row and line 146 assigns `platformRole`, and line 171 exempts PLATFORM_ADMIN_ROLES from the route role check — so asserting any admin's user id yields admin authority. optionalAuth repeats it at line 231. The file itself documents the hazard at line 20: "`isUserIdFallbackAllowed()` infers permission from `NODE_ENV`, and that inference has been wrong in production-adjacent environments before: a staging deployment running `NODE_ENV=test` turns the spoofable `x-user-id` header into a working identity." The remediation applied was scoped to evidence/passport routes only (`isPrivateEvidenceFallbackAllowed`, line 54-56, which correctly requires the explicit flag); the general path still infers. By contrast activityLedgerService.js:410-412 refuses the same inference outright: "NO NODE_ENV inference. CarUp has already run NODE_ENV=test inside a staging PRODUCTION environment, which turned every such check into an open door."

**Disposition (honest):** MITIGATED, not maximally closed. The NODE_ENV inference is now
conjoined with the deployment environment — it is ignored entirely when `CARUP_ENV` or
`VERCEL_ENV` is `production`, which is exactly the condition that held during the recorded
staging incident, so that incident is closed. The maximal remedy (explicit flag only) was NOT
applied: 52 backend test files depend on `NODE_ENV=test` enabling the header, so flag-only
would require changing all of them plus every CI workflow. That migration is recorded as an
open obligation rather than attempted here.

**Required behaviour (full remedy, still open):** Make isUserIdFallbackAllowed require the explicit opt-in only — `return env.CARUP_ALLOW_X_USER_ID_FALLBACK === 'true'` — matching isPrivateEvidenceFallbackAllowed and the stated policy in activityLedgerService.js. Set CARUP_ALLOW_X_USER_ID_FALLBACK=true in local/CI env files so the suite and local dev are unaffected. If a staged rollout is preferred, keep the NODE_ENV clause but conjoin it with `env.CARUP_ENV !== 'production' && env.VERCEL_ENV !== 'production'` so no single mis-set variable can open it.

### [CLOSED] Every secret the #194 subsystems require is missing from both environment templates, so provisioning from them yields a server that boots healthy and throws on first ledger write

**Location:** `backend/env.example:1`

**Evidence:** Verified absent from BOTH .env.example and backend/env.example (grep for each name, including commented forms): CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET, CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET, CARUP_BLOCKCHAIN_KEY_VERSION, CARUP_BLOCKCHAIN_LEGACY_SYSTEM_HMAC_SECRETS, INTELLIGENCE_WORKER_SECRET, CARUP_ALLOW_SYNTHETIC_ACTIVITY, CARUP_ALLOW_X_USER_ID_FALLBACK, CORS_ALLOWED_ORIGINS, SENTRY_DSN, REDIS_URL, CAPABILITY_KILL_SWITCH, CARUP_AGENT_GATEWAY_SECRET, ESCROW_TRUST_WEBHOOK_SECRET, FINANCE_WEBHOOK_SECRET, INSURANCE_WEBHOOK_SECRET, SAFEPAY_WEBHOOK_SECRET. The first two are hard requirements that throw at runtime (blockchainKeyCustodyService.js:23-26 and :122), and because startup validation covers only SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (server.js:154-159), their absence is invisible until the first stakeholder or system ledger write. The templates are otherwise meticulous — they document optional Diaspora Drive and billing flags in commented detail — so the omission reads as oversight, not deliberate scoping.

**Required behaviour:** Add every name above to backend/env.example (and the frontend-relevant ones to .env.example) with the same explanatory comments the Email 1.0 block uses, marking which are REQUIRED-in-production versus optional. Pair this with finding 7 so a missing required secret is caught at boot rather than at first use.


### [CLOSED] A FAILED marketplace evidence/PartSentry/ownership read is published as a governed negative

**Location:** `backend/services/marketplace/listingSummaryService.js:939`

**Found by:** the V16 convergence SJO-4 audit. Recorded rather than fixed — see the disposition.

**Evidence:** `maybeFetchRows` catches ANY error and `return []` (line 951), with only a
`console.warn`. It is the reader for `vehicle_evidence`, `vehicle_ownership_history` and (via
`fetchPartSentryRows`) `partsentry_logs` in `fetchListingRelatedRows` (:1262-1267). Downstream an
empty array is indistinguishable from a successful empty read: `derivePartSentryPublicStatus`
returns `'not_applicable'` for `!allRows.length` (:467), and the evidence/ownership counts become 0.
So a database fault publishes a governed negative — "no PartSentry record applies", zero verified
evidence, zero ownership history — to a buyer, on the marketplace card and the listing detail.
The SAME file already solves this correctly one line down for images: `readListingImages` returns
`{ rows, ok }`, `fetchListingRelatedRows` publishes `listingImagesRead: imageRead.ok`, and its
comment states that `false` means "the query did not resolve and NO negative about listing media
may be published from this result" (:1257-1259). Evidence, PartSentry and ownership have no such
discriminator.

**Required behaviour:** give `maybeFetchRows` the `{ rows, ok }` shape the image reader already
uses, propagate an `ok` flag per source through `fetchListingRelatedRows`, and make each consumer
publish an explicit unavailable/unknown state instead of a negative when its source did not
resolve.

**Disposition (V16 convergence): CLOSED.** Initially recorded as a bounded residual on the grounds
that the function is byte-identical to `origin/main` and the fix looked like a five-service refactor.
Independent adversarial verification (3 lenses, 7 confirmations across the finding's verifiers) then
established that the consequence is worse than the original write-up: it is not merely an evidence
count, it is a SAFETY-SIGNAL INVERSION. `deriveSuspicionLevel([])` is `'clear'`, so a failed
`partsentry_logs` read publishes `risk_status: 'clear'`, suppresses the marketplace risk banner and
sets `operator_review_required: false` — for a vehicle whose rows might carry `flagged`. That
reclassification made the trade obvious, and the fix turned out to be contained: `buildTrustSummary`
has exactly ONE production call site.

`maybeFetchRows` and `fetchPartSentryRows` now return `{ ok, rows }` — the same discriminator
`readListingImages` already used, and for the same stated reason. `fetchListingRelatedRows`
publishes `evidenceRead` / `partSentryRead` / `ownershipRead`; `buildTrustSummary` maps an unread
input to `'unavailable'` for both `evidence_status` and `suspicion_status` and FAILS CLOSED on
`risk_status`, which carries the vehicle into `operator_review_required` rather than quietly passing
it. The shared `MarketplaceRiskStatus` / `MarketplaceEvidenceStatus` enums gained `'unavailable'`,
and `TrustSummaryPanel` renders it as "Not checked" with an explicit banner stating that the absence
of a warning is not an all-clear.

**Evidence:** `backend/tests/marketplace-trust-inputs-unreadable.test.js` — 8/8, including the
inversion case (a failed read and a clean vehicle must not produce the same verdict), the
anti-vacuity twin (a SUCCESSFUL empty read still reads `clear`/`none`, because a measured zero is
correct), a real `flagged` row still raising the alarm, and a quarantined vehicle still outranking
an unreadable input.

## P2 (13)

### [OPEN] Diaspora ownership handoff fabricates a recorded odometer of 0 km on the canonical vehicles row

**Location:** `backend/services/diaspora/diasporaOwnershipHandoffService.js:209`

**Evidence:** backend/services/diaspora/diasporaOwnershipHandoffService.js:200-215 `insertVehicleIdentity` inserts into `vehicles` with `mileage: 0, // no odometer attestation captured yet` (line 209) and `price: 0, // identity handoff — not listed for sale` (line 210). `mileage` is `INTEGER NOT NULL` (database/migrations/supabase_schema.sql:52), so the zero is written as a real value, and the read contract classifies it as recorded: backend/utils/publicVehicleProjection.js:443-447 `isRecordedValue` returns true for any finite number including 0, so `toSpecificationClaim` (publicVehicleProjection.js:964 `mileage: statedValue(row.mileage)`) publishes `{value: 0, state: 'recorded'}`. That reaches anonymous callers: `app.get('/api/vehicles/:vin/passport', passportLimiter, optionalAuth(), ...)` at backend/server.js:1474 calls buildVehiclePassport (backend/server.js:880-895), which selects the row by VIN alone with no publication_status or status gate. This contradicts the codebase's own stated rule at backend/services/marketplace/marketplacePricingService.js:29 ("APPLIES TO mileage: where a fact was never recorded, the honest output is nothing, not zero").

**Required behaviour:** Make `vehicles.mileage` nullable in a migration and write NULL from the handoff (the projection already renders `not_recorded` correctly), or keep the column and carry an explicit provenance/state column the projection gates on. Do the same for `price: 0`. Until then the handoff must not publish a passport-visible specification block for these rows.

### [OPEN] Genesis ownership is written to two ledgers with different answers, bypassing the governed transfer authority

**Location:** `backend/server.js:2721`

**Evidence:** On POST /api/vehicles/add the vehicles row records `owner_id: candidate.owner_id` (backend/server.js:2587) while the ownership ledger records the ACTOR: backend/server.js:2720-2722 `await supabase.from('vehicle_ownership_history').insert({ vin, new_owner_id: req.userContext.id, transfer_date: ..., transfer_hash: 'INITIAL' })`. `candidate.owner_id` is not the actor for two of the three role branches — backend/services/marketplace/marketplaceListingEligibility.js:264-274: role 'dealer' -> `owner_id = null; tenant_id = ctxTenant`, and the else branch (admin / platform-admin, which bypasses the allow-list at backend/middleware/authMiddleware.js:172 via `!PLATFORM_ADMIN_ROLES.has(platformRole)`) -> `owner_id = body.owner_id ?? null` (line 273), i.e. client-supplied. So a dealer listing yields `vehicles.owner_id = NULL` while vehicle_ownership_history names that dealer user as the vehicle's owner, and an admin listing yields `vehicles.owner_id = <body value>` while the ledger names the admin. This row also carries no `previous_owner_id` and `transfer_id IS NULL`, so it is invisible to the governed authority added in database/migrations/20260828203000_passport_ownership_transfer_authority.sql (whose uniqueness index `uq_vehicle_ownership_history_transfer` is `WHERE transfer_id IS NOT NULL`). The live passport counts these rows unconditionally at backend/server.js:1109.

**Required behaviour:** Write the same identity to both ledgers — use `candidate.owner_id` for the INITIAL history row and skip the row entirely when there is no owner (dealer/tenant listings) — and stop accepting `body.owner_id` in the admin branch of buildVehicleListingCandidate; an admin assigning ownership should go through passport_begin/transition_ownership_transfer_atomic like every other ownership change.

### [OPEN] Public odometer-audit endpoint is a second, narrower odometer authority that returns verified:true for any unknown VIN

**Location:** `backend/services/trustGraph/trustGraphService.js:259`

**Evidence:** backend/server.js:1544 `app.get('/api/vehicles/:vin/odometer-audit', async (req,res) => { const audit = await runOdometerAudit(vin); res.json(audit); })` — no auth, no 404. backend/services/trustGraph/trustGraphService.js:259-309: `const { data: vehicle } = await supabase.from('vehicles').select('mileage').eq('vin', vin).single(); const baseMileage = vehicle ? vehicle.mileage : 0;` then reads ONLY `partsentry_logs`, and returns `verified: anomalies.length === 0`. For a VIN that does not exist, or one with zero service logs, the response is `{verified: true, checkpointsCount: 0, baseMileage: 0, anomalies: []}` — a positive verification claim produced by checking nothing. It is also strictly narrower than the codebase's own multi-source odometer aggregator: backend/services/report/canonicalVehicleLifecycleService.js gathers readings from vehicle_evidence.odometer_value (line 235), partsentry_logs.mileage (line 269), vid_inspections.odometer_reading (line 307), listing_snapshots.advertised_mileage (line 313) and vehicles.mileage (line 331), and computes its own `mileageAnomaly` at lines 371-375. Two endpoints can therefore give opposite answers about the same vehicle's odometer integrity.

**Required behaviour:** Have runOdometerAudit delegate to the canonical lifecycle mileage projection (or delete the endpoint in favour of it), and replace the boolean `verified` with an explicit coverage state so 'no checkpoints' and 'unknown VIN' report not_evaluated / 404 rather than verified.

### [OPEN] The JS passport transfer state machine duplicates the SQL transfer contract and already disagrees with it

**Location:** `backend/services/passport/passportTransferStateMachine.js:33`

**Evidence:** backend/services/passport/passportTransferStateMachine.js:33-34 declares `complete: new Set(['disputed'])` and `cancelled: new Set(['initiated'])`, and `canTransitionPassportTransfer` (line 42) only special-cases completion via `if (previouslyCompleted && to === CANCELLED) return false`. The authority — database/migrations/20260828203000_passport_ownership_transfer_authority.sql, function passport_transition_ownership_transfer_atomic — says the opposite for cancelled (`WHEN 'cancelled' THEN FALSE`) and gates the whole post-completion subgraph on `completed_at IS NOT NULL` rather than on the transition target. The JS module has no non-test consumers: grep across backend/web/docs finds it only in backend/tests/passport-v7-ownership-transfer.test.js:11,166 and docs/vehicle-passport-lifecycle/receipts/V7_OWNERSHIP_TRANSFER_CERTIFICATION.md:15. The live path (backend/routes/passportOwnershipTransferRoutes.js -> backend/services/passport/passportOwnershipTransferService.js:64,73) calls the RPC directly and never consults this file.

**Required behaviour:** Delete the JS state machine, or reduce it to a table generated from / asserted against the SQL contract by a test. A second lifecycle definition that nothing runs will be wired in by a future change and silently permit transitions the database refuses (or vice versa).

### [OPEN] verifyTradeProfile accepts trust_score from the request body and fabricates an 80 floor

**Location:** `backend/services/diaspora/diasporaTradeProfileService.js:253`

**Evidence:** `const trustScore = Math.min(100, Math.max(previous.trust_score || 50, payload.trust_score || 80));` followed at line 257 by `.update({ verification_status: 'VERIFIED', trust_score: trustScore, ... })`. `payload` is `req.body` (backend/routes/diasporaRoutes.js:176 `router.post('/trade-profiles/:id/verify', reviewerAuth, ... verifyTradeProfile(req.params.id, req.body, ...))`). Two defects in one line: the trust number is client-supplied, and when it is omitted the act of verification alone manufactures an 80 — the same unfounded default (84/80) that ADR-001 and canonicalTrustService.js:36-38 exist to remove. The `Math.max` also makes the score monotonic: verification can only ever raise it. Confirmed reviewer-gated via `isPrivileged` (diasporaTradeProfileService.js:14, 247), so this is privileged misuse rather than an open door.

**Required behaviour:** Drop `payload.trust_score` entirely and let verification set only `verification_status`, leaving the number to `recalculateTradeProfileReputation` (the one computing writer for this column). If verification must influence the score, add it as a term in that function, not as a body field.

### [OPEN] Foreign trust writers demote the canonical score with no re-materialisation path

**Location:** `backend/services/document-intelligence/documentIntelligenceService.js:406`

**Evidence:** `await supabase.from('vehicles').update({ trust_score: finalScore, status: 'Available', ...UNSTAMPED_TRUST_CACHE }).eq('vin', vin);` — and identically at backend/services/trust-service/trustEnforcementEngine.js:100 and :185. Nulling the six stamp columns is correct for authority, but it moves the row to `unversioned` -> `not_evaluated` (canonicalTrustService.js:56-60), so every public surface withholds that VIN's score. Neither call site then calls `refreshCanonicalTrust`; `grep -rn refreshCanonicalTrust backend` shows the only production callers are backend/routes/vehiclesRoutes.js:987 and :1082 (evidence verify/reject) and backend/services/golden/goldenVehicleFixture.js. The only batch re-materialiser, .github/workflows/issue164-canonical-trust-refresh-production.yml, is `workflow_dispatch:`-only (line 68) with no `schedule:`. So an OCR approval or an OCR-mismatch penalty silently and permanently removes a vehicle's published trust score until a human dispatches a workflow.

**Required behaviour:** Have each foreign writer call `await refreshCanonicalTrust(vin)` immediately after its unstamped write (guarded in try/catch, as vehiclesRoutes.js:986-990 already does), so the row returns to a stamped canonical state instead of being parked at `not_evaluated`.

**O2-X1 addendum (2026-09-03):** the documentIntelligenceService call site no longer exists — the OCR-approval writer was retired outright, so this finding now concerns ONLY the two `trustEnforcementEngine` sites, which still lack a re-materialisation path. The entry stays OPEN at reduced scope.

### [CLOSED] Unauthenticated /api/verification/trust-score/:userId exposes a second user-trust engine for any user id

**Location:** `backend/services/document-intelligence/documentIntelligenceRouter.js:88`

**Evidence:** `router.get('/trust-score/:userId', async (req, res) => { const score = await TrustService.calculateUserTrustScore(userId); res.json({ userId, trustScore: score }); })` with no auth on route or router (mount: backend/server.js:300). `calculateUserTrustScore` (backend/services/trust-service/trustService.js:90-119) computes a 20.0-baseline score from `users.phone`, verified `identity_documents` rows, `kyc_profiles.overall_status` and a `security_events` VERIFICATION_FAILURE count. Any anonymous caller can enumerate user ids and read back whether that user has a phone on file, verified identity documents, biometric KYC, and how many verification failures they have — and the number itself is a second trust computation unrelated to canonicalTrustService.

**Required behaviour:** Gate with `authorizeRole(['admin'])` or remove the route; if a user-facing trust tier is needed, expose it only for `req.userContext.id` and derive it from the governed verification session state rather than this parallel engine.

**O2-X1 addendum (2026-09-03):** resolved by removal — the route and the parallel engine (`calculateUserTrustScore`) are deleted with the rest of the legacy lane; no second user-trust computation remains.

### [OPEN] COMMUNICATION_FAKE_ADAPTERS_ENABLED substitutes FakeCommunicationAdapter for every real transport in production, and BLOCKED startup validation only logs

**Location:** `backend/services/communication/adapters/providerAdapters.js:1072`

**Evidence:** `const allowFake = !isRealEnvironment || env.COMMUNICATION_FAKE_ADAPTERS_ENABLED === 'true';` (line 1072) — the flag overrides the `NODE_ENV === 'production'` check on line 1071, so whatsapp/telegram/email/sms/instagram/facebook/push (lines 1080-1086) all become FakeCommunicationAdapter, which returns `accepted:true, providerStatus:'delivered'` for every send (adapters/fakeCommunicationAdapter.js:15-32). The one hard startup guard disables itself on the same flag: `if (env.COMMUNICATION_FAKE_ADAPTERS_ENABLED === 'true') return;` (line 1047 in assertRealTelegramAdapter). The configuration validator does classify this as BLOCKED (communicationConfigurationValidator.js:190-198, code `fake_adapters_enabled`), but backend/server.js:178-179 only does `console.error('❌ Communication configuration BLOCKED:', ...)` and continues — unlike the OCR check 12 lines above it, which throws FATAL. Net effect: one env var turns all outbound comms into silently-successful no-ops in production with no fail-closed enforcement.

**Required behaviour:** Make a BLOCKED startup validation fatal in production/staging (throw, as the STRICT OCR check at backend/server.js:165 already does), or drop the COMMUNICATION_FAKE_ADAPTERS_ENABLED escape hatch entirely when NODE_ENV is production/staging so `allowFake` cannot be re-enabled from configuration.

### [OPEN] Webhook signature verification accepts body.test===true under NODE_ENV=test on an unauthenticated public route

**Location:** `backend/services/communication/communicationWebhookService.js:164`

**Evidence:** The default branch of `verify()` returns `Boolean(shared && headers['x-channel-webhook-secret'] === shared) || Boolean(body?.test === true && this.env.NODE_ENV === 'test')` (line 164); the same `body.test` bypass is repeated for sendgrid (line 107), twilio (line 136) and expo (line 141). `CommunicationCanonicalWebhookService extends CommunicationWebhookService` and inherits `verify` unchanged (communicationCanonicalWebhookService.js:1,12,18), and it is the service wired by createCommunicationServices (communicationServiceFactory.js:120-127). `handleWebhook` gates solely on that result — `const signatureValid = this.verify(provider, normalized, {...})` (line 640) — and the route `router.post('/api/communications/webhooks/:provider/:channel', ...)` (backend/routes/communicationBaseRoutes.js:324) carries no auth middleware and takes `provider` as a free path param. If NODE_ENV is ever 'test' in a deployed environment — which has already happened in this codebase's staging Production — an unauthenticated POST with `{"test":true}` passes verification and forges inbound messages and delivery receipts into the canonical communications store.

**Required behaviour:** Delete the `body?.test === true && NODE_ENV === 'test'` disjunct from all four branches and have tests inject a test env/secret through the constructor's `env` instead, matching the resend branch which already refuses any test-mode fallback (lines 110-117).

### [OPEN] Unauthenticated POST /api/insurance/quote reads an arbitrary user's private trust score and any VIN regardless of publication state

**Location:** `backend/server.js:1765`

**Evidence:** `app.post('/api/insurance/quote', async (req, res) => { const { vin, userId } = req.body; ... await calculateInsuranceQuote(vin, userId) ... })` — no auth middleware, and both the vehicle and the identity come from the request body. backend/services/insurance/insuranceService.js:5 does `supabase.from('vehicles').select('*').eq('vin', vin).single()` with no `publication_status`/`status` filter (so a draft or quarantined VIN is confirmed to exist, unlike GET /api/vehicles/:vin/details at server.js:477 which applies the visibility gate), and line 8 does `supabase.from('stakeholder_profiles').select('trust_score').eq('user_id', userId).single()` for whatever user id the caller names. The returned `riskScore` (line 20) is `50 + agePenalty*100 - (trustScore - 70)` with `agePenalty = (currentYear - vehicle.year) * 0.02`, so given the publicly listed year the target user's private trust_score is recoverable exactly, and `yearlyPremium` discloses `price`. Only the global 100/min per-IP limiter applies.

**Required behaviour:** Put `authorizeRole([])` on the route and take the applicant from `req.userContext.id` instead of `req.body.userId`; apply the same publication/status visibility filter the other public vehicle reads use before quoting.

### [OPEN] Email 1.0 runbook advertises an object the migration deliberately does not create (and a test forbids)

**Location:** `docs/communications/EMAIL_1_0_MIGRATION_RUNBOOK.md:16`

**Evidence:** The runbook is pinned to the exact bytes of the migration — line 4: "**SHA-256 `bf8c1cbfbec807cc2839720416521e584964457c1264bfd9ae9fa20d4ff680e0`**", and `shasum -a 256 database/migrations/20260826120000_email_1_0_hardening.sql` returns exactly that hash, so the runbook is current for this file. Yet its change table, line 16, still lists: "| **BOUNDARY** | `communication_activation_boundaries` + row for `email_1_0`; index refinements | **new** — the durable watermark that prevents a retroactive mass send |". `grep -rn communication_activation_boundaries` over the whole repo returns only two hits: this runbook line, and `backend/tests/email-hardening-durability-scheduler.test.js:726`, which asserts the opposite — `assert.equal(migration.includes('communication_activation_boundaries'), false);` inside test 'AUTHORITY-2 no reconciliation control state lives on client-reachable tables any more'. The migration creates `public.communication_reconciliation_work` instead, and its own header calls the watermark design one of the two abandoned predecessors: "The first INFERRED outstanding work from timestamps (\"verified after a watermark\") ... turned the watermark itself into a client-writable table." The runbook's own later section (line ~74) even says "Both mechanisms are gone (never applied anywhere)" — contradicting its own summary table. The runbook header also says "Six changes", counting the phantom row.

**Required behaviour:** Replace the stale BOUNDARY row in the change table with the row that describes what the migration actually delivers (`communication_reconciliation_work` + the two enqueue triggers + the two SECURITY DEFINER functions), and correct "Six changes" if the count moves. This migration is marked NOT APPLIED and is destined for a governed production apply, so the operator's change table and postflight list must name only objects that will exist.

### [CLOSED] Startup validation covers only two variables, so a deployment missing JWT_SECRET or the ledger signing secrets boots and reports healthy

**Location:** `backend/server.js:154`

**Evidence:** The complete boot-time guard is `if (!process.env.SUPABASE_URL) throw ...; if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw ...;` plus a conditional OCR check (server.js:154-168). JWT_SECRET is validated only lazily inside resolveCsrfSecret (securityMiddleware.js:20-25), and the blockchain secrets only inside masterSecret/currentSystemSecret. The communication validator IS run at startup but only logs: `if (startupCommunicationConfiguration.status === 'BLOCKED') { console.error('❌ Communication configuration BLOCKED:', startupCommunicationLog); }` (server.js:177-179) — no throw. So a process missing CSRF or ledger secrets passes boot, serves /api/health with `status: 'UP'`, and fails only when a user hits the affected path.

**Required behaviour:** Extend the existing startup block with a required-in-production list (JWT_SECRET, CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET, CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET, SAFEPAY_WEBHOOK_SECRET and the other provider webhook secrets), gated on the existing IS_PRODUCTION helper so local and CI runs are unaffected. Keeping communication BLOCKED as non-fatal is defensible — a degraded channel should not take down the marketplace — but a missing signing or CSRF secret should refuse to boot.

### [OPEN] Unauthenticated /api/health discloses build SHA, deployment id, per-endpoint latency map, process memory/CPU and outbox backlog

**Location:** `backend/server.js:238`

**Evidence:** `app.get('/api/health', async (req, res) => {` is registered with no auth middleware, and the global chain (server.js:190-220) is cors, correlation, telemetry, securityHeaders, rateLimiter, edgeClientIp, body parsers and csrfMiddleware — csrfMiddleware exempts GET outright (securityMiddleware.js:163-166). The response includes `build: resolveBuildProvenance()` (commit_sha, branch, deployment_id, environment), `ocrProviders` naming which AI provider keys are configured, `communications.providers[].explanations`, and `metrics: snapshot` which is `{ uptimeSeconds, systemMetrics: { cpuUsage: process.cpuUsage(), memoryUsage: process.memoryUsage() }, outbox, ocr, webhooks, trustEngine, escrows, api: { totalRequests, errorsCount, averageLatencyMs, endpointsLatency } }` (metrics.js:178-197). `endpointsLatency` enumerates every route path the instance has served, giving an anonymous caller a route map plus the exact revision to diff against public source.

**Required behaviour:** Split the endpoint: keep an unauthenticated liveness probe returning only `{status, timestamp}` (plus commit_sha if the certification workflows need it — they do, per buildProvenance.js), and move `metrics`, `systemMetrics` and the provider explanations behind the operator auth already used by diasporaSchedulerRoutes.js:177. If the full body must stay public for the existing UAT workflows, drop `endpointsLatency` and `systemMetrics` at minimum.


## P3 (2)

### [OPEN] Trust-fact approval mutates governed fact columns without refreshing the cached evidence basis

**Location:** `backend/services/trustGovernance/trustFactWorkflowService.js:450`

**Evidence:** `await updateVehicle(supabaseClient, request.vin, newValue.vehicle_patch);` where the patch sets `passport_verified`/`passport_verified_at`/`passport_verification_source` or `inspection_ready` (approvalVehiclePatch, lines 97-112) — and `revocationVehiclePatch` (lines 114-129) reverses them. Those columns are inputs the canonical read path consults: canonicalTrustService.js:226-233 lists `passport_verified` and `inspection_ready` in FACT_CONTEXT_COLUMNS, and the resolver's output is cached as `trust_evidence_basis` and `trust_known_limitations` by buildCachePatch (canonicalTrustService.js:911-918). `refreshCanonicalTrust` is not called anywhere in this file (it does not appear in the `grep -rn refreshCanonicalTrust backend` caller list), so after an approval or revocation the cached `evidence_basis`/`known_limitations` published on every surface still describe the pre-decision fact state.

**Required behaviour:** Call `await refreshCanonicalTrust(request.vin)` (best-effort, in try/catch) after `updateVehicle` in both `approveTrustFactRequest` and `revokeTrustFactRequest`, exactly as the evidence review routes do at backend/routes/vehiclesRoutes.js:986-990.

### [OPEN] optionalAuth copies the unverified x-tenant-id header into userContext.tenantId

**Location:** `backend/middleware/authMiddleware.js:247`

**Evidence:** `tenantId: req.headers['x-tenant-id'] || null,` inside `optionalAuth()` — unlike `authorizeRole`, which validates the same header against `tenant_users` and 403s a non-member (lines 150-162), optionalAuth performs no membership check. No live exploit today: the one consumer that could widen access on it defends itself explicitly (backend/server.js:1699-1704 refuses to use it for PartSentry full-history and falls back to an owner_id match), and lenderRoutes.js:85 reads `req.userContext?.tenantId` only on an authorizeRole route. It is a loaded gun for the next optionalAuth route that scopes a query by tenant.

**Required behaviour:** Either verify membership in optionalAuth the way authorizeRole does, or stop publishing `tenantId` from optionalAuth at all and expose only a `claimedTenantId` name that reads as untrusted at every call site.

---

# Addendum — restored-draft save path, independent audit at `52352271`

Raised by the PR #194 directive of 2026-09-01, which required the restored Seller draft /
existing-Passport save path to be **inspected independently rather than accepted as already fixed**.
This addendum is a separate cycle from the 79-agent audit above; its counts are its own.

The eleven commits `8a068e6b…52352271` were read against exact head, not against their description.

## Verified correct — no change made

Recording these explicitly, because "no finding" is only meaningful if it says what was examined.

- **The identity-conflict 409 cannot leak to an unauthorised caller.** `SELLER_IDENTITY_CONFLICT_REVIEW_REQUIRED`
  and its `conflicting_fields` are produced only inside the `existing && reuse_existing_passport === true
  && existingSellerRelationship` branch (`backend/server.js`). A caller without that relationship
  falls through to `SELLER_AUTHORITY_CLAIM_REQUIRED`, which names no field and reveals no recorded value.
- **`authorityState === 'recognized'` on a restored draft is governed, not advisory.** It is set from the
  authenticated `fetchOwnedVehicles()` scope match, never from the public passport lookup.
- **The VIN input is locked on a restored draft** (`disabled={canonicalLocked}`), so the `set('vin')`
  authority reset is unreachable there.
- **The identification notice hides its confirm control once confirmed**, so its `setAuthorityState('idle')`
  handler cannot clobber established authority.
- **A sold listing genuinely leaves the public surface.** `PUBLICLY_VISIBLE_PUBLICATION_STATUSES` is
  `['published']` alone and `isPublicVehicleStatus` excludes `Sold`; mark-sold retires correctly while
  preserving publication history, exactly as R27 requires.

## Findings

### [CLOSED] P1 — a restored draft was held hostage by the advisory Passport lookup

**Location:** `web/src/pages/dashboard/owner/SellVehicle.tsx` — `validateStep()`, and the step-0 Next button.

**Evidence:** `else if (identifying) e.vin = 'Wait for the CarUp Passport check to finish'`, plus
`disabled={step === 0 && (identifying || authorityState === 'checking')}`. Both consult
`useSellerVehicleIdentification`, the public, rate-limited, audience-gated check. On a restored draft the
authenticated scope read had *already* answered the same question, yet a slow or 429-throttled advisory
read pinned the seller at step 0 of their own listing. The save itself was decoupled; reaching it was not.

**Disposition:** one named predicate, `governedScopeEstablished`, now gates the step-0 ladder, the Next
button and `reuse_existing_passport`. The relaxation is scoped to a restored draft: a seller who merely
types an identifier CarUp already holds still faces the full confirm-and-declare-authority gate.
Regression test `web/src/pages/dashboard/owner/SellVehicle.restoredDraft.test.tsx` (3 tests); the two
behavioural ones were confirmed to FAIL against the pre-fix component.

### [CLOSED] P1 — the authority-claim panel could demote authority already proved

**Location:** same file, the `seller-existing-passport-authority` block.

**Evidence:** rendered on `identification.state === 'passport_exists' && form.existingPassportConfirmed`,
both of which are true on a restored draft. Its buttons call `resolveExistingPassportAuthority`, which sets
`evidence_required` on a non-recognized answer and `error` on a transport failure. Nothing restores
`recognized` short of a page reload, so on the seller's *own* draft the panel could only ever take authority
away — after which `reuse_existing_passport` went false and the save returned 409.

**Disposition:** the panel is no longer offered once `governedScopeEstablished` holds. Covered by the same
regression file.

### [CLOSED] P2 — a 17-character identifier carrying I, O or Q was accepted

**Location:** `web/src/lib/sellerVehicleIdentification.ts`, `backend/server.js`.

**Evidence:** the widening to `/^[A-Z0-9-]{12,17}$/`, made for genuine Japanese frame identifiers, also
widened the alphabet for real VINs. ISO 3779 excludes I, O and Q precisely so they cannot be read as 1, 0
and 0; accepting `…5987O34` beside `…5987034` lets one mistyped character mint a SECOND Passport — the
duplicate the identification flow exists to prevent.

**Disposition:** an identifier of exactly 17 characters with no hyphen is held to the ISO 3779 alphabet;
shorter or hyphenated documented frame identifiers keep the wider one, so the import that motivated the
widening still lists. The rule moved to `backend/utils/sellerVehicleIdentifier.js` so it is importable and
directly testable; `backend/tests/seller-vehicle-identifier.test.js` (8 tests) covers it and asserts
mechanically that the browser and server patterns agree, rather than trusting a comment to keep them in step.

### [CLOSED] P2 — a failed crash-recovery write silently killed the save

**Location:** `web/src/lib/guestSellDraft.ts` `clearGuestSellMedia()`; `SellVehicle.tsx` `handleSubmit`.

**Evidence:** `saveGuestSellDraft` is fail-soft on every storage path it guards except one — its no-media
branch awaited `clearGuestSellMedia()` unguarded, and `IDBDatabase.transaction()` throws synchronously
(InvalidStateError on a closing connection, NotFoundError after another tab's version upgrade). The new
pre-save checkpoint awaited that call *outside* `handleSubmit`'s try and ahead of `setSubmitting(true)`, so
a seller pressing "Save as Draft" on a photo-less listing got nothing at all: no spinner, no toast, no
listing, no error.

**Disposition:** fixed at the source, so the fail-soft contract holds for every caller, and guarded again at
the call site. `web/src/lib/guestSellDraft.failSoft.test.ts` (2 tests), confirmed to fail pre-fix at
`clearGuestSellMedia:130 → saveGuestSellDraft:173`.

### [CLOSED] P1 — the media-lifecycle contamination gate detected but never remediated

**Location:** `.github/workflows/seller-media-lifecycle-staging-uat.yml`.

**Evidence:** run `33505710788` (head `52352271`) passed desktop and mobile lifecycle and then failed
"Refuse to leave an automation listing public" on `JTMLCMXB053051151`. Decoding that identifier — `JTMLC` +
project token `MXB` (mobile-chromium) + run token `053051151` — attributes it to run `33505305115`, which was
**cancelled** eight minutes earlier. With `concurrency: cancel-in-progress: true`, every push to the candidate
branch SIGKILLs the run in flight; a run killed between publish and mark-sold leaves a published automation
listing on shared staging with nothing to retire it. The step only detected, and scanned the global `JTMLC`
prefix, so one aborted run reddened every later run for ever while the actual contamination stayed public.
The listing was confirmed live and publicly discoverable as "Available" at the time of this audit.

**Disposition:** the step now retires what it finds, through the product's own authenticated login + CSRF +
`POST /api/vehicles/:vin/unpublish` rather than reaching past the authority rules. "Publicly discoverable"
is asked with the product's own predicate (`publication_status === 'published'` AND an available/reserved
status), so a listing this run correctly retired via mark-sold is left untouched and its publication history
is not rewritten. Residue from an earlier aborted run is remediated and reported as such; residue from *this*
run still fails the gate, because the spec must retire its own listing. Residual, stated plainly: a cancelled
run's contamination persists until the next run sweeps it, since nothing can execute after SIGKILL.

### [CLOSED] P3 — fixture exclusion reported a reason that could not be reached

**Location:** `backend/services/marketplace/marketplaceClassificationRules.js` `getFixtureExclusion()`.

**Evidence:** two backend tests were RED at exact head `52352271` (confirmed pre-existing, not introduced by
this cycle). `SYNTHETIC_VIN_RE` was tested before `INTEGRATION_VIN_RE`, and every integration fixture is also
named `VIN…`, so the `integration_fixture_vin` branch was unreachable: an operator reading an exclusion
report was told "synthetic prefix" about a row excluded for being an integration fixture. The rows were
always excluded — only the diagnosis was wrong.

**Disposition:** the more specific marker is asked first. Both orders exclude exactly the same set
(synthetic OR integration OR underscored); no acceptance criterion was weakened to obtain green.
`marketplace-classification-rules` + `-backfill` now 35/35.
