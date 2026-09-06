# GMO-8 governed cleanup debt — Supabase Storage (staging)

Direct deletion is refused by design:

```
ERROR: 42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.
HINT:  This prevents accidental data loss from orphaned objects.
CONTEXT: PL/pgSQL function storage.protect_delete() line 5 at RAISE
```

Storage was **not weakened** to work around this, and the guard is correct.

## This session's run-owned objects

| bucket | objects | size | kind |
|---|---|---|---|
| `ocr-documents` | 43 | 23 MB | 4 signage (`garage-onboarding/<application-id>/signage_photo-*.png`) + 39 identity (`<user-id>/<session-id>/{front,back,selfie}-*.png`) |

Window: `2026-09-06 21:50:44Z` → `2026-09-06 22:19:16Z`.

All 43 are now **orphaned**: their owning `users`, `garage_applications` and
`verification_sessions` rows were deleted, so nothing in the database references them.

## Pre-existing backlog (not created by this session)

145 further orphaned objects in the same bucket, 6,329 kB, oldest `2026-07-30 00:28:44Z`. Recorded
because the same missing capability produced them, and because a cleanup routine that lands later
should sweep the whole set rather than only this run's.

**Total orphaned in `ocr-documents`: 188 objects, 29 MB, across 118 distinct prefixes.**

## Classification

**GOVERNED CLEANUP DEBT.** Removing these needs the Storage API with service-role authority, which
this environment does not hold — `vercel env pull` returns empty values for Sensitive variables, so
there is no service-role key to be had that way. There is also **no cleanup script in the
repository** (`scripts/` contains none), which is the more durable gap: every UAT run of this
journey deposits synthetic identity images that nothing is able to remove.

Recommended (not done here, as it is a new capability rather than this lane's work): a governed
sweeper that deletes `ocr-documents` objects whose owning verification session no longer exists.
