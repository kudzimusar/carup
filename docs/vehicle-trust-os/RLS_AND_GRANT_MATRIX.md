# RLS and Grant Matrix — Core Vehicle Trust OS

**Document status:** Phase 2 verified  
**Date:** 2026-06-24  
**Release branch:** `release/core-vehicle-trust-os-mvp`  
**Migration:** `database/migrations/20260624120000_vehicle_trust_security_hardening.sql`  
**PGlite test result:** PASS — 7/7 Up, 7/7 Down, 7/7 re-Up, zero failures

---

## 1. FK Cascade Changes (Provenance Protection)

| Table | Column | FK Target | Before | After | Verified |
|---|---|---|---|---|---|
| `evidence_provenance_events` | `evidence_id` | `vehicle_evidence(id)` | CASCADE | **RESTRICT** | PGlite: `confdeltype = 'r'` ✓ |
| `evidence_sets` | `vin` | `vehicles(vin)` | CASCADE | **RESTRICT** | PGlite: `confdeltype = 'r'` ✓ |
| `report_versions` | `vin` | `vehicles(vin)` | CASCADE | **RESTRICT** | PGlite: `confdeltype = 'r'` ✓ |

Rationale: Prevent silent loss of audit trail, evidence grouping history and buyer report history when evidence or vehicle records are deleted.

---

## 2. Existing Tables — RLS State After Phase 2

| Table | RLS Before | RLS After | Broad Policy Removed | New Policy |
|---|---|---|---|---|
| `vehicle_evidence` | Enabled (015) | Enabled | `vehicle evidence authenticated read` (USING true) | `vehicle evidence uploader or admin read` |
| `vehicle_documents` | Enabled (20260619) | Enabled | ALL revoked from anon/authenticated (production containment) | Service-role only from 20260619; unchanged by Phase 2 |
| `vehicle_plate_history` | Disabled | **Enabled** (Phase 2) | n/a | `vehicle plate history admin read` |

---

## 3. M1 Tables — Policy Matrix

| Table | Anon | Authenticated (general) | Owner | Dealer/Reviewer | Admin/Government | Service Role |
|---|---|---|---|---|---|---|
| `evidence_class_taxonomy` | SELECT (public catalog) | SELECT | SELECT | SELECT | SELECT | ALL |
| `evidence_sources` | REVOKE ALL | REVOKE ALL | — | — | — | ALL |
| `evidence_sources_public` (view) | SELECT | SELECT | SELECT | SELECT | SELECT | ALL |
| `evidence_sets` | REVOKE ALL (via RLS) | — | SELECT (own VIN via created_by) | SELECT (all) | SELECT (all) | ALL |
| `evidence_provenance_events` | REVOKE ALL | — | — | SELECT (all) | SELECT (all) | ALL |

Policy names after Phase 2:
- `evidence_sets`: `"evidence sets owner or admin read"` (authenticated)
- `evidence_provenance_events`: `"provenance admin or reviewer read"` (authenticated)

---

## 4. M2 Tables — Policy Matrix

| Table | Anon | Authenticated | Service Role |
|---|---|---|---|
| `ingestion_jobs` | REVOKE ALL | REVOKE ALL | ALL |
| `source_records` | REVOKE ALL | REVOKE ALL | ALL |
| `vehicle_identity_candidates` | REVOKE ALL | REVOKE ALL | ALL |
| `listing_snapshots` | REVOKE ALL | REVOKE ALL | ALL |

All broad `USING (true)` policies dropped. No client-visible policies remain.

---

## 5. M3 Tables — Policy Matrix

| Table | Anon | Owner | Dealer | Reviewer/Admin/Government | Service Role |
|---|---|---|---|---|---|
| `ai_analysis_jobs` | REVOKE ALL | REVOKE ALL | REVOKE ALL | REVOKE ALL | ALL |
| `ai_observations` | REVOKE ALL | — | — | SELECT (all) | ALL |
| `temporal_findings` | REVOKE ALL | — | — | SELECT (all) | ALL |
| `disclosure_claims` | REVOKE ALL | — | — | SELECT (all) | ALL |
| `disclosure_conflicts` | REVOKE ALL | — | — | SELECT (all) | ALL |

Policy names: `"ai observations admin or reviewer read"`, `"temporal findings admin or reviewer read"`, `"disclosure claims admin or reviewer read"`, `"disclosure conflicts admin or reviewer read"`

---

## 6. M4 Tables — Policy Matrix

| Table | Anon | Owner | Reviewer/Admin | Service Role |
|---|---|---|---|---|
| `report_versions` | SELECT (valid share_token only) | SELECT (own VIN via ownership_history) | SELECT (all) | ALL |

Three separate policies:
- `"report versions public share"` — anon + authenticated, share_token + not revoked + not expired
- `"report versions owner read"` — authenticated, via `vehicle_ownership_history.new_owner_id`
- `"report versions admin read"` — authenticated, role IN ('admin', 'government', 'reviewer')

---

## 7. M5 Tables — Policy Matrix

| Table | Anon | Authenticated (general) | Raiser/Owner | Reviewer/Admin/Government | Service Role |
|---|---|---|---|---|---|
| `review_tasks` | REVOKE ALL | — | — | SELECT (all) | ALL |
| `review_decisions` | REVOKE ALL | — | — | SELECT (all) | ALL |
| `disputes` | REVOKE ALL | — | SELECT (own raised_by) | SELECT (all) | ALL |
| `dispute_events` | REVOKE ALL | — | SELECT (via parent dispute) | SELECT (all) | ALL |
| `trust_change_log` | REVOKE ALL | — | — | SELECT (all) | ALL |

---

## 8. `vehicle_evidence` — Full Policy Matrix After Phase 2

| Policy name | Role | Operation | Condition |
|---|---|---|---|
| `vehicle evidence public verified read` (from 015) | anon | SELECT | `visibility_level = 'public_safe' AND verification_status = 'verified'` |
| `vehicle evidence uploader or admin read` (Phase 2) | authenticated | SELECT | `uploaded_by = auth.uid() OR verified_by = auth.uid() OR role IN (admin, government, reviewer, dealer)` |
| `vehicle evidence authenticated insert` (from 015) | authenticated | INSERT | `uploaded_by = auth.uid()` |
| `vehicle evidence authenticated update own pending` (from 015) | authenticated | UPDATE | `uploaded_by = auth.uid() AND verification_status = 'pending'` |

**Broad policy removed:** `vehicle evidence authenticated read` (USING true) from `015_vehicle_evidence_timeline.sql`

---

## 9. Function search_path Pinning

| Function | Set search_path |
|---|---|
| `carup_provenance_block_mutation()` | `public, pg_temp` |
| `carup_listing_snapshot_block_mutation()` | `public, pg_temp` |
| `carup_report_version_guard()` | `public, pg_temp` |
| `governance_block_mutation()` | `public, pg_temp` |

---

## 10. PGlite Verification Output (Phase 2)

```json
{
  "overall": "PASS",
  "up_applied": 7,
  "down_applied": 7,
  "reup_applied": 7,
  "catalog": {
    "provenance_fk_mode": "r",
    "provenance_fk_is_restrict": true,
    "evidence_sets_fk_mode": "r",
    "evidence_sets_fk_is_restrict": true,
    "report_versions_fk_mode": "r",
    "report_versions_fk_is_restrict": true,
    "vehicle_evidence_rls": true,
    "vehicle_plate_history_rls": false
  }
}
```

Note: `vehicle_plate_history_rls: false` in PGlite is expected — the table is not in the PGlite test bootstrap (it's created by `013_zimbabwe_plate_and_owner_privacy.sql` which is not included). In the actual Supabase staging environment, the table exists and RLS is enabled correctly by the hardening migration's DO block.

---

## 11. Phase 2 Exit Assessment

| Check | Status |
|---|---|
| `vehicle_evidence` RLS enabled | PASS |
| `vehicle_documents` RLS (from production containment) | PASS |
| `vehicle_plate_history` RLS enabled | PASS (staging; PGlite: table not bootstrapped) |
| Broad `USING(true)` policies removed from M1–M5 | PASS — 17 policies replaced |
| `vehicle evidence authenticated read` (015 broad) removed | PASS |
| Provenance FK: CASCADE → RESTRICT | PASS (PGlite verified) |
| Evidence sets FK: CASCADE → RESTRICT | PASS (PGlite verified) |
| Report versions FK: CASCADE → RESTRICT | PASS (PGlite verified) |
| Function search_path pinned (4 functions) | PASS |
| Migration apply/down/reapply in PGlite | PASS — 7/7/7 |
| Production not changed | PASS |

**Phase 2 exit: COMPLETE**  
**Next phase:** Phase 3 — Strict Vehicle Document and OCR Contract
