# GMO-8 fixture-cleanup DEBT — measured at the PASS run

**Nothing in this file claims something was deleted when it was not.**

Two mechanisms deliberately refuse deletion, and both are correct. The right response to *"my test
cleanup is inconvenienced by a governed guard"* is to leave the guard alone and record the residue.

---

## 1. Append-only audit — `service_case_events`

```
ERROR P0001: service_case_events is append-only (attempted DELETE)
CONTEXT: PL/pgSQL function service_case_events_append_only()
```

A completed Service Network job writes an audit trail that cannot be deleted. That trail references
the service case, which references the tenant, the customer and the vehicle. So **any GMO-8 run that
actually completes Act 6b leaves a permanent, governed trace by design** — which is the same
property that makes revocation safe (history survives the loss of authority).

Run-owned state that *was* removed and verified at zero: garage applications, decisions, documents,
invitations, `tenant_users` memberships, garage profiles, branches, work-order assignments,
mechanic work orders, service records and their evidence/parts/mileage children, verification
sessions/assessments/provenance/decisions, OCR documents and their per-type children, notification
queue, user sessions, ownership history.

### Residue after the PASS run (runs `mtqq53x6`, `mtqqgr0m`, `mtqqmmwv`, `mtqqs274`, `mtqrivm7`)

| what | count | why it survives |
|---|---|---|
| `service_cases` | 3 | referenced by append-only events |
| `service_case_events` | 12 | **append-only by design** |
| `tenants` | 3 | referenced by the surviving cases |
| `users` | 13 | requester/attribution on the surviving cases |
| `vehicles` (`GMX8UAT…`) | 4 | referenced by the surviving cases |
| `tenant_users` memberships | **0** | fully removed |
| `garage_applications` | **0** | fully removed |
| `service_records` | **0** | fully removed |

The synthetic Operations reviewer is retained on purpose.

---

## 2. Private Storage — `ocr-documents`

```
ERROR 42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.
CONTEXT: storage.protect_delete()
```

The Storage API path needs a service-role key this environment does not hold. **Weakening
`storage.protect_delete()` or RLS to tidy synthetic test files would be the worse trade**, so it was
not done.

| measure | value |
|---|---|
| bucket | `ocr-documents` (private) |
| objects under `u_*` prefixes | **171** |
| total objects in bucket | **309** |
| object prefix | `<user_id>/<verification_session_id>/<side>-<uuid>.png` |

Each identity submission adds three objects. That is the honest expected behaviour of a run, not a
surprise.

---

## What an authorised cleanup would need

1. A service-role credential used from a controlled context, calling the **Storage API** — never
   `DELETE FROM storage.objects`.
2. A prefix allow-list restricted to `u_*` prefixes whose owning `public.users` row no longer
   exists, i.e. orphaned synthetic evidence only.
3. A dry-run that prints the object list before deleting anything.
4. For the database side: an explicit decision about whether synthetic audit trails may ever be
   pruned. **That is a governance question, not a cleanup script.** Until it is answered, a GMO-8
   run that completes Act 6b leaves the residue above, and this file is where it is counted.
