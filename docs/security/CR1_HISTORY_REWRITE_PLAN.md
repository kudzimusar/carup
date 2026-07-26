# CR-1 — Coordinated History-Rewrite & Re-Clone Plan (PREPARED, NOT EXECUTED)

> **Execution requires the owner's explicit authorization phrase: `APPROVE CR-1 HISTORY REWRITE`.**
> Until then: no history rewrite, no force-push, no ref deletion, no re-clone requirement. This plan
> contains no secret values.

## Scope (measured 2026-07-26 on `main@08463d8`)

- **93 commits** (all refs) touch the production project ref; **13 commits** touch credential-shaped
  `postgres://` URIs. Range: repo origin (2026-05-31, `0e766fd`) → present.
- Refs to cover: **84 remote branches**, **1 tag** (`rc/diaspora-9164500`), **15 stashes**,
  **1 preserved ref** (`refs/preserved/diaspora-wip-cc42b41` → `0052fd39`), all open PR head refs.
- Replacement patterns (applied to ALL history):
  1. `postgres(ql)://<user>:<password>@<host>` → `postgres://<user>:[ROTATED-SEE-CR1]@<host>`
     (password component only, preserving host context for auditability).
  2. The production DB password literal(s) identified during rotation → `[ROTATED-SEE-CR1]`.
  3. (Optional, owner decision) production project ref in historical *executable* blobs → left as-is;
     it is a non-secret identifier and full removal would break historical migration-ledger meaning.

## Tooling

`git filter-repo --replace-text cr1-replacements.txt --refs --all` (preferred over BFG for precise
`--replace-text` semantics and stash/notes handling). The replacements file is generated at execution
time from the rotation records and **never committed**.

## Pre-flight (before any rewrite)

1. **Rotation complete** (see CR1_CREDENTIAL_ROTATION_CHECKLIST.md) — old values dead.
2. **Repository freeze:** announce a freeze window; require all worktrees pushed or stashed; verify
   every open PR's head SHA recorded.
3. **Full backup:** `git clone --mirror` to an offline location + `git bundle create carup-pre-cr1.bundle --all`
   including stashes exported as patches:
   `for i in $(seq 0 14); do git stash show -p stash@{$i} > stash-$i.patch; done`
   plus explicit object backup of `0052fd39` (`git bundle create preserved-stash.bundle refs/preserved/diaspora-wip-cc42b41`).
4. **Inventory manifest:** record every branch/tag/stash/preserved-ref SHA before and after; the
   preserved stash must be re-created byte-identically after the rewrite (its diff content contains no
   secrets — verified — so it is re-applied unchanged).

## Execution sequence (owner-authorized window)

1. Freeze pushes (branch protection: lock all branches).
2. Run `git filter-repo` on a fresh mirror clone; verify replacement counts match the measured scope.
3. Verify: `git log --all -S '<rotated-password-fingerprint>'` returns 0; scanner
   (`scripts/cr1-secret-scan.mjs`) clean across the rewritten tree at every branch tip.
4. **Force-push with lease** all rewritten refs (`git push --mirror --force-with-lease`), including
   tags; re-create `refs/preserved/diaspora-wip-cc42b41` and re-import the 15 stashes.
5. Invalidate old clones: rotate GitHub deploy keys/tokens if any cache old packs; document that
   **every collaborator must re-clone** (old SHAs are invalid); CI caches cleared.
6. Verify all open PRs re-point cleanly (GitHub rewrites PR base/head refs on force-push; any PR that
   breaks is re-created from the rewritten branch).
7. Post-rewrite audit: fresh full-history scan (0 findings) recorded in the risk register.

## Rollback

The offline mirror + bundle restore the pre-rewrite state exactly (`git push --mirror` from backup).
Rollback re-exposes the (already-rotated, dead) values — acceptable because rotation precedes rewrite.

## Explicitly out of scope

Production Supabase access, production migrations (#11–#18), production deploys (EB-5), and any change
to the merged Diaspora release content.

---
**STATUS (2026-07-26): EXECUTED under explicit owner authorization.** 901 commits rewritten; 72→0 credential URIs; prod ref preserved (owner scope correction); 74/74 branches lease-pushed; fresh-clone full-history scan = 0. See docs/security/CR1_EXECUTION_LEDGER.md.
