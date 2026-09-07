# Staging fixture-cleanup DEBT — private `ocr-documents` bucket

**This is debt, not a completed cleanup.** Nothing in this file claims an object was deleted.

Every GMO-8 certification run uploads three identity images (front, back, selfie) to the private
Supabase Storage bucket `ocr-documents`, under the prefix `<user_id>/<session_id>/`. Database state
is fully removable and *is* removed after every run. **The storage objects are not**, and this
records exactly why, exactly how many, and what an authorised cleanup would need.

## Why they are not deleted

```
DELETE FROM storage.objects …
ERROR 42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.
HINT:  This prevents accidental data loss from orphaned objects.
CONTEXT: storage.protect_delete()
```

The platform refuses direct deletion, correctly. The Storage API path requires a service-role key
that this environment does not hold. **Weakening `storage.protect_delete()` or RLS, or obtaining a
broader key, to tidy synthetic test files would be a worse trade than carrying the debt** — so
neither was done.

## Measured, at the close of the Qwen convergence run

| measure | value |
|---|---|
| bucket | `ocr-documents` (private) |
| total objects in the bucket | **277** |
| object prefix | `<user_id>/<verification_session_id>/<side>-<uuid>.png` |
| earlier measurement, previous task | 144 objects under `u_*` prefixes |

### Objects owned by GMO-8 runs, by run id (all owner accounts since deleted)

| owner / run id | objects | which run |
|---|---|---|
| `u_f64b7d03419644bc` | 30 | Gemini-era journey run + repeated direct provider probes |
| `u_181c65987d64460c` | 6 | Qwen-convergence-era journey run |
| `u_1b2e5ebf6184471d` | 3 | contract-probe run |
| `u_9703cfd8998a4dac` | 3 | provider-backed run 2 |
| `u_54a4dde6d31c4ad1` | 3 | provider-backed run 1 |
| **GMO-8 subtotal** | **45** | every owning account deleted and verified at zero |

The rest of the bucket predates this programme: `garage-onboarding/` (14), Golden-Reference vehicle
fixtures (`CARUPGLDN*`, VIN-prefixed objects), and earlier O2 runs.

## What an authorised cleanup needs

1. A service-role credential, used from a controlled context, calling the **Storage API** (never
   `DELETE FROM storage.objects`).
2. A prefix allow-list restricted to `u_*` prefixes whose owning `public.users` row no longer
   exists — orphaned synthetic evidence only. The query that produces that list is in this file's
   history; it joins `storage.objects` to `public.users` on the leading path segment.
3. A dry-run that prints the object list before deleting anything.

Until that exists, **every GMO-8 run adds three objects per identity submission**, and that is the
honest expected behaviour rather than a surprise.

## The related product question

A run cannot currently delete what it created. That is a fixture-ownership gap, and it is the same
gap that makes concurrent certification runs dangerous: two sessions sharing a lane can each delete
state the other still needs. Database cleanup is now strictly run-scoped by account prefix; the
storage side cannot be until an authorised deletion path exists.
