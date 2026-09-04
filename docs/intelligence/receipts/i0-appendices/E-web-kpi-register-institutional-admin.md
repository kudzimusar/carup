# I0 Part B — Institutional/Admin KPI Register (branch content == main@ba208963)

Format: `surface/route | component file:line | metric | data source | classification | empty/loading/error behaviour`
All paths relative to `web/src/` unless prefixed `backend/`.

## 1. INSURANCE DASHBOARD

### /insurance-dash (home) — `pages/dashboard/insurance/InsuranceDashboard.tsx`
Plan assertion **VERIFIED**: fabricated claims/premium/risk numbers were removed from this page (comments at :8-10, :31-33, :114-116 document the removal).
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Active Policies / Pending Claims / Fraud Alerts / Monthly Premiums tiles | :34-37 | literal `'Not available'` | unavailable-truthful | static text, no fake zeros |
| Claims Overview chart | :11, :60-62 | `claimData` = empty literal array | unavailable-truthful | renders "Claims history is not available yet." (`insurance-claimchart-empty`) |
| Recent Claims list | :13, :88-90 | `recentClaims` = empty literal array | unavailable-truthful | "No claims recorded yet." |
| Key Metrics (Claim Approval Rate / Risk Score / Fraud Detection Accuracy) | :117-119 | literal "Not available" | unavailable-truthful | never drawn as bar; comment :114-116 notes the removed hardcoded "98.7%" |
| Fraud Alerts card | :129 | literal copy "counts are not available" | unavailable-truthful | — |

### /insurance-dash/claims — `Claims.tsx`
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Claims list + per-claim $amount | :26, :107 | `fetchClaims` → GET `/api/insurance/claims` → `insurance_claims` table (backend/routes/claimsRoutes.js:13-20) | authoritative-live | skeletons while loading; toast + empty list on error; "No claims found." empty state (:149-153). Minor: `?? 0` renders `$0` for null amount (:107); missing date falls back to *today's date* (:112) — a small fabrication |

### /insurance-dash/risk — `RiskAnalysis.tsx` — **NOT remediated; fabricated remnants**
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Risk by Vehicle Category chart (SUVs 3.2/45 … Luxury 5.8/18) | :13-19 | hardcoded `riskByCategory` literal | static-demo | always drawn, never marked demo |
| Initial Risk Score 24.5% / Premium $145.00 / 3 "Positive" factors ("Odometer progressive validation passed", "ZIMRA duty cleared in Harare") | :28-37 | hardcoded initial `riskData` state | static-demo | shown on first paint before any calculation; on API error the fabricated values persist (catch only toasts :45-46) |
| Recalculated risk/premium after button press | :42, hooks/useCarUpApi.ts:924-929 | POST `/api/ai/risk-assessment` → `runRiskScoring` = raw Gemini prompt, **no DB/ledger grounding** (backend/services/ai/aiServiceBus.js:79-93; throws if no GEMINI_API_KEY, GeminiClient.js:13-14) | derived-live (LLM-generated, ungrounded) | "Analyzing..." button state; toast on failure, stale values remain |
| "Includes 25% Trust Score discount" | :112 | hardcoded string | static-demo | always shown regardless of result |
| Insurance Trust Engine Parameters (25%/10%/5% discounts) | :155-158 | hardcoded rules array | static-demo | presented as engine parameters; no backing engine |
| Default VIN `VIN74329849204928`, mileage 48500, price 42000 | :23-25 | hardcoded form defaults | static-demo | — |

### /insurance-dash/fraud — `FraudAlerts.tsx`
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Open / Under Investigation / Resolved tiles | :42-44, :54-56 | derived from `fetchFraudAlerts` → GET `/api/security/fraud-alerts` → `fraud_alerts` table (backend/server.js:2555-2566) | derived-live | skeletons; on error toast + counts show **0** (fake-zero: alerts stays `[]` :24-26); "No fraud alerts found." empty state. Note case mismatch: backend resolve writes `'Resolved'` (server.js:2573) but UI filters lowercase `'resolved'` (:44) — resolved rows can be miscounted |

## 2. BANK DASHBOARD — legacy/static remnants confirmed

### /bank (home) — `pages/dashboard/bank/BankDashboard.tsx`
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Loan Disbursement Volume chart (Jan 150k…May 450k) | :22-28, :110-123 | hardcoded `loanTrend` | static-demo | always drawn |
| Tiles: Active Financed Assets **$1,245,000** / Pending Applications **4** / Avg APR **7.5%** / Collateral Default Risk **1.2%** | :73-76 | string literals | static-demo | never fetched, never updated |
| "CBZ Bank Partner Portal" header | :57 | literal — names a real bank | static-demo | — |
| Lending Applications Queue (3 rows) | :39-40, :145-169 | `fetchFinanceApplications` → GET `/api/finance/applications` | authoritative-live | skeletons; toast on error; "No lending applications pending." |
| AI Credit Scoring Copilot "Confidence Threshold: 98.4% Passed" + activity narrative | :186-191 | hardcoded | static-demo | asserts non-existent live AI monitoring |
| Portfolio Risk Tier bars 84/12/4% | :219-228 | hardcoded `Progress` values | static-demo | always full-drawn bars |

### /bank/applications — `LendingQueue.tsx`
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Active Applications count, per-row amount/monthly/APR/trust score bars | :22, :81, :142-152 | GET `/api/finance/applications` (+ PATCH-style POST `/finance/applications/:id/update`) | authoritative-live | skeletons; toast on error; truthful empty "No lending applications found in database ledger." No fabricated numbers |

### /bank/collateral — `CollateralMap.tsx` — **fabricated fallback confirmed**
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Map markers + "Connected Vehicles" list | :26-28 | `fetchTelemetry` → GET `/api/telemetry` → `vehicle_telemetry` table (backend/server.js:2540-2551) | authoritative-live when non-empty | — |
| **Fallback fleet on empty result** (3 fake VINs, "Toyota Hilux GD-6 · Harare CBD · 45 km/h" etc.) | :30-36 | hardcoded array injected when table empty | fallback (fabricated) | empty DB silently shows invented assets |
| **Fallback fleet on fetch error** (2 fake VINs) | :39-43 | hardcoded, comment says "Fallback for demo" | fallback (fabricated) | error silently shows invented assets |
| "N Financed Assets Connected" counter | :93 | `assets.length` — counts the fabricated fallback | derived from fallback | inherits fabrication |
| "GPS Telemetry Core Active" / "Ledger Sync: OK" badges | :90, :99 | hardcoded | static-demo | asserted unconditionally |
| "No active geofence breaches detected" | :131 | hardcoded copy | static-demo | no geofence system exists |

### /bank/risk — `CreditRiskAnalysis.tsx` — **fabricated initial state confirmed**
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Portfolio Risk Distribution chart initial (A:8 B:4 C:2 D:1) | :12-17 | hardcoded initial state | static-demo→derived-live | replaced only if API returns ≥1 app (:24); on error or empty result the fabricated grades persist silently (catch only console.error :46-48) |
| Total Portfolio Value initial **$1,245,000** | :18, :110-112 | hardcoded initial state | static-demo→derived-live | same persistence-on-error hazard |
| AI Credit Model Factors (35/25/20/20% weights) | :84-87 | hardcoded | static-demo | no backing model |
| Non-Performing Loans **0.00%** + "Healthy" badge | :119-121 | hardcoded | static-demo | fake zero presented as measurement |
| Escrow Coverage **100%** bar | :127-129 | hardcoded | static-demo | always full |

## 3. GOVERNMENT SURFACES

### /government (home) — `pages/dashboard/government/GovernmentDashboard.tsx` — heavily static
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Monthly Registrations chart (Jan 1200…May 1380) | :12-18, :173-180 | hardcoded `registrationData` | static-demo | always drawn |
| Tiles: Registered Vehicles **1.2M** / Pending Verifications **234** / Verified Today **89** / Security Alerts **3 Active** | :80-83 | string literals | static-demo | never fetched |
| ZIMRA duty result initial ($10,125 / 101.25% / VAT 1500 / surtax 3500) | :28-33, :129-141 | hardcoded initial state | static-demo→derived-live | replaced only after button press via POST `/api/import/duty-estimate` (`calculateZimraDuty`, deterministic backend calc — derived-live); error keeps stale values (toast :48) |
| MFA session log ("Inspector T. Chihuri", "ZIMRA Desk Officer Moyo", IPs, times) | :36-39, :153-163 | hardcoded array — **fabricated named officers** | static-demo | presented as "Secure Hardware Session Audits" with "Protected" badge :150 |
| "Segmented Access Protocol Active" RBAC claims | :69-72 | hardcoded copy | static-demo | asserts enforcement state without measurement |

### /government/compliance — `ComplianceReports.tsx`
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Total / Generated / Pending / Compliance Rate tiles | :47-50, :59-62 | derived from `fetchComplianceReports` → GET `/api/compliance/reports` → `compliance_reports` table (backend/server.js:2586-2597) | derived-live | skeletons while loading; on error toast + tiles show **0 / 0%** (fake zeros, reports stays `[]`); truthful empty list state :80-82 |
| Download button | :36-45 | `setTimeout(2000)` + success toast — **no file is downloaded** | static-demo (simulated action) | claims "downloaded successfully!" falsely |

### /government/registry — `RegistryVerification.tsx`
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Verification rows | :23, GET `/api/compliance/registry` | authoritative-live | authoritative-live | skeletons; toast on error; truthful empty state :120-125 |
| Registration column `'TBA'`, Owner column `'Unknown Owner'`, Type `'New Registration'` | :30-32 | hardcoded per-row placeholders | fallback (placeholder) | every row shows the same placeholder owner/registration in real columns |

### /government/evidence, /government/trust-review, /government/governance-review
Shared with admin — see EvidenceReview / TrustReviewQueue / GovernanceReviewQueue below (all live).

## 4. ADMIN SURFACES

### /admin (home) — `pages/dashboard/admin/AdminDashboard.tsx` — **partially remediated**
Remediated: fabricated partner-org table (Croco/Simbisa/Old Mutual/CBZ/ZIMRA) and fake VIN fraud rows removed → empty arrays + truthful empty states (:72-78, :136-141 "No governed organization registry is published yet.", :168-171).
Remnants:
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| User Growth chart (Jan 4500…May 9200) | :10-16, :196-203 | hardcoded `userGrowth` | static-demo | always drawn |
| Initial stats (totalUsers **9200**, aiConfidence **'98.5%'**, systemHealth 'Optimal') | :20-27 | hardcoded initial state | fallback (fabricated) | on fetch error ALL fabricated values display (catch only console.error :44-45); per-field `\|\| prev` keeps fabricated value whenever API field is 0/absent (:36-41) |
| Ecosystem Users tile | :93 | GET `/api/admin/stats` → real `users` count (backend/routes/adminRoutes.js:33-54) | authoritative-live (with fabricated fallback above) | change chip '+18%' hardcoded |
| "Supervised Organizations: N Active" tile | :94 | **`stats.totalVehicles`** (vehicles count) mislabeled as organizations | derived-live, **mislabeled** | change chip '+20%' hardcoded |
| SafePay Escrow Volume tile | :95 | `totalEscrows` count (escrow_trust_sessions) but **`'$145,000'` literal shown when count is 0** | fallback (fabricated) | fake dollar figure exactly when there is no data; '+32%' hardcoded |
| Fraud Intercept Rate tile | :96 | `stats.aiConfidence` — backend returns hardcoded `'98.5%'` (adminRoutes.js:52) | static-demo served via API | looks live, is a literal; '+0.4%' hardcoded |
| Active AI Copilots ("Dealer Pricing Copilot" / "Simbisa Diagnostics AI" / "Old Mutual Underwriter Copilot" all "Online") | :214-226 | hardcoded — names real institutions | static-demo | asserted always-online |

### /admin/users — `UserManagement.tsx`: fully live (GET `/api/users/management`), skeletons, toast on error, truthful empty (:156). No KPI tiles.

### /admin/ai — `AIMonitoring.tsx` — static remnants
| metric | file:line | source | class | empty/err |
|---|---|---|---|---|
| Tiles: Total Requests **24.5K** / Avg Response **1.2s** / Accuracy **97.2%** / Active Sessions **142** | :60-63 | string literals | static-demo | never fetched |
| Request Volume 24h chart | :12-19 | hardcoded | static-demo | always drawn |
| Accuracy Trend chart (Mon-Sun 95-98) | :21-29 | hardcoded | static-demo | always drawn |
| AI Model Status list | :39, hooks:2098 → GET `/api/admin/health` → `server_health` table (adminRoutes.js:70-77) | authoritative-live (table contents may themselves be seeded) | skeletons; toast on error; truthful "No health data available" :143 |

### /admin/moderation — `MarketplaceModeration.tsx`: live. Tiles Total/Public/Suppressed/Rejected/Inquiries (:286-292) from `fetchMarketplaceAnalytics`, falling back to counts derived from the loaded listings array (:272-277) — derived-live fallback, not fabricated. Inquiries failure shows explicit migration note (:221, :337-338) — unavailable-truthful. AI advisory labels source truthfully ("AI advisory" vs "Deterministic advisory", :251).

### /admin/evidence — `EvidenceReview.tsx`: Queue/Photos/Documents tiles derived from live queue (`fetchEvidenceReviewQueue`, :46-50) — derived-live; spinner, toast on error, truthful empty (:111-115).

### /admin/fraud-queue — `FraudQueue.tsx`: live (`fetchFraudCases`), signal counts per case from API (:38), skeletons, toast, truthful "No open fraud cases."

### /admin/dealer-compliance — `DealerCompliance.tsx`: live (`fetchDealers`), eight statuses shown separately (:24-30), truthful empty "No dealer profiles yet." No numbers fabricated.

### /admin/verification — `IdentityVerificationCaseManagement.tsx`: live; explicitly refuses fake zeros — error state renders "Queue counts are unavailable until this succeeds — they are NOT zero." (:325; comment :175 cites a staging regression that motivated this). Field-level "Not available" (:646). Exemplary truthful pattern.

### VerificationReview.tsx (`/admin` legacy identity review): tiles Queue Items / Awaiting Decision derived from live queue (:308-312); OCR confidence % from API `confidence_score` (:363) — derived-live.

### /admin/features — `FeatureGovernanceConsole.tsx`: rollout percentages live from Feature Registry override records (:283, :298); embeds NavigationAnalyticsPanel (:229).

### NavigationAnalyticsPanel — `components/admin/NavigationAnalyticsPanel.tsx`: fully live GET `/api/admin/analytics/navigation` (:107-111); totals/splits/top-surfaces/zero-selection all from API (:168-207); explicit loading spinner, permission-denied state (:152), error state (:153), truthful empty "No navigation analytics recorded for this range." (:154). **No fake zeros, no static data.** Model panel for part B.

### /admin/communications — `Communications.tsx`: all live (`fetchAdminCommunicationThreads/Metrics/DeadLetters/WorkerHealth/Providers`). Queue filter chips use server `counts` (:698). Hazards: ops metrics fetch failures are swallowed (`.catch(() => undefined)` :365-367) so open/unassigned/overdue/dead-letter header renders **0** on error (:597-599, :619) — fake zeros; dead-letters error → `[]` (:364).

### /admin/referrals* (Campaigns, Codes, LocalLeads, ImportRoutes, Marketing, TrustReview): all live via useCarUpApi; no KPI tiles, no hardcoded numbers found (grep for literal %/$ values and static arrays returned none beyond enum/config constants).

### /admin/trust-review, /admin/governance-review — `shared/TrustReviewQueue.tsx`, `shared/GovernanceReviewQueue.tsx`: live queues via useCarUpApi; constants are enum lists only.

### /admin/diaspora/compliance — `pages/diaspora/DiasporaTrade.tsx:1553` (DiasporaComplianceAdmin): live (`fetchDiasporaComplianceReviews`); no KPIs. Hazard: refresh has no `.catch` (:1567-1570) — fetch error silently renders the "No compliance reviews found." empty state (unavailable presented as empty).

### /admin/diaspora/workbooks(+/new) — `DiasporaWorkbookOperatorConsole.tsx` / `DiasporaWorkbookDryRun.tsx`: SummaryMetric tiles render live plan totals; absent values shown as literal "None" (compactValue :104-110) — unavailable-truthful.

## 5. PLAN-ASSERTION VERDICTS
1. "Insurance dashboard already removed fabricated claims/premium/risk numbers" — **TRUE only for the /insurance-dash home page** (InsuranceDashboard.tsx fully remediated). **FALSE for /insurance-dash/risk**: RiskAnalysis.tsx retains fabricated riskByCategory chart (:13-19), fabricated initial riskScore/premium/factors (:28-37), hardcoded discount claims (:112, :155-158).
2. "Bank screens still contain legacy/static or fallback-like values" — **TRUE**: BankDashboard.tsx :22-28, :73-76, :186-191, :219-228; CollateralMap.tsx :30-44 (fabricated fallback fleets on empty AND on error), :90/:99/:131; CreditRiskAnalysis.tsx :12-18 (fabricated initial persisting on error), :84-87, :119-129.
3. "Admin screens still contain legacy/static or fallback-like values" — **TRUE but narrower**: AdminDashboard.tsx :10-16, :20-27, :93-96 (esp. `'$145,000'` zero-fallback :95 and backend-served `'98.5%'`), :214-226; AIMonitoring.tsx :12-29, :60-63. All other admin panels (moderation, evidence, fraud-queue, dealer-compliance, identity verification, referrals, communications, feature governance, nav analytics, diaspora) are live, with the fake-zero-on-error caveats noted for Communications ops strip and ComplianceReports tiles.
4. Government surfaces (not mentioned in plan) are the **worst remaining surface**: GovernmentDashboard.tsx is ~fully fabricated (tiles :80-83, chart :12-18, named-officer MFA log :36-39) and ComplianceReports simulates downloads (:36-45).

## 6. BACKEND LITERALS SERVING "LIVE-LOOKING" NUMBERS
- backend/routes/adminRoutes.js:51-52 — `/api/admin/stats` returns hardcoded `systemHealth:'Optimal'`, `aiConfidence:'98.5%'` alongside real counts.
- backend/services/ai/aiServiceBus.js:79-93 — `/api/ai/risk-assessment` numbers are pure LLM output, no vehicle-data grounding despite UI copy "based on live ledger Trust Scores".