# Phase 7C Gate 2 — Owner Mobile Smoke Test

## Purpose

Run one real-device staging journey to prove that non-document evidence is never presented as a verified identity and that an admin resubmission request reaches the applicant mobile experience.

## Important: backend and web are already deployed

You do **not** need to run the backend server locally.

Use ONLY these deployed staging services for the CURRENT release branch
(`release/phase7c-verification-production`). Aliases from the superseded
PR #72 guide (`...git-phase-7c-nati-...`) must NOT be used — pointing the
app at them was device-test defect #1.

Use these deployed staging services:

- Staging backend: `https://carup-backend-staging-git-release-phase-81c126-pay-pass-project.vercel.app`
- Staging web: `https://carup-staging-git-release-phase7c-verif-2d8ff1-pay-pass-project.vercel.app`
- Staging Supabase project: `eoyenigwevnxwwhyhaer`

Only the Expo mobile development server needs to run on the Mac. The Expo server serves the mobile JavaScript bundle; API requests go directly to the deployed staging backend.

## Safe local checkout

Use a clean worktree so existing local changes are not disturbed.

```bash
cd "/Users/shadreckmusarurwa/Project AI/carup-kimi"

git fetch origin

git worktree remove /private/tmp/carup-phase7c-gate2 --force 2>/dev/null || true

git worktree add --detach \
  /private/tmp/carup-phase7c-gate2 \
  origin/release/phase7c-verification-production

cd /private/tmp/carup-phase7c-gate2

git rev-parse HEAD
```

Expected current branch SHA at guide creation:

`1b3c5e5409d8df2940603edf25be4ddc99456d27`

A later SHA is acceptable if the PR advanced. Record the SHA actually shown.

## Install dependencies

From the worktree root:

```bash
npm ci --legacy-peer-deps
```

This repository is an npm workspace. Run installation from the repository root, not from `mobile/`.

## Configure the mobile app for staging

Create a temporary local environment file inside `mobile/`:

```bash
cat > mobile/.env.local <<'EOF'
EXPO_PUBLIC_API_URL=https://carup-backend-staging-git-release-phase-81c126-pay-pass-project.vercel.app
EXPO_PUBLIC_ALLOW_LOCALHOST_API=false
EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK=false
EOF
```

Do not commit `mobile/.env.local`.

The mobile verification client requires `EXPO_PUBLIC_API_URL` and refuses localhost on a physical device unless explicitly overridden.

## Start Expo

From the repository root:

```bash
cd mobile
npx expo start --tunnel --clear
```

Why `--tunnel`:

- the phone does not need to be on the same local network as the Mac
- it avoids LAN/router discovery problems
- the backend remains the deployed HTTPS staging backend

Leave this terminal window running.

## Open on the phone

1. Open Expo Go on the phone.
2. Scan the QR code shown in the terminal or Expo developer page.
3. Wait for the CarUp mobile bundle to load.
4. Permit camera/photo access when requested.

If Expo Go reports an SDK mismatch, update Expo Go from the App Store and restart the command.

## Test accounts

Use the existing Gate 1 staging accounts. Credentials are shared separately in the owner chat and must not be committed to this repository.

Required accounts:

- Applicant: `gate1-applicant-v2-1781841379@carup.test`
- Admin: `gate1-admin-v2-1781841379@carup.test`
- Non-admin reference account: `gate1-nonadmin-v2-1781841379@carup.test`

Do not create additional Gate 2 accounts unless login fails and the owner explicitly authorizes replacement.

## Part A — Applicant mobile submission

1. On the mobile login screen, enter the applicant email and staging test password.
2. Tap **SIGN IN — VISIBLE CTA**.
3. On the dashboard, tap **Start Verification Flow**.
4. Choose the national ID or double-sided identity-document path.
5. For the front image, photograph a cup or coffee mug.
6. For the back image, photograph a different household object.
7. For the selfie, take a normal selfie.
8. Submit verification.

Expected mobile result:

- no Verified Identity badge
- no trusted extracted name, ID number or date of birth
- status is pending review or equivalent truthful state
- the app does not claim that OCR output proves identity

Keep the mobile app open on the result screen.

## Part B — Admin requests resubmission

On the Mac, open:

`https://carup-staging-git-release-phase7c-verif-2d8ff1-pay-pass-project.vercel.app`

1. Sign in using the Gate 1 admin account.
2. Open `/admin/verification`.
3. Find the newest applicant session.
4. Confirm it is not verified and shows the invalid/too-small evidence reason.
5. Select **Request Resubmission**.
6. Use reason code `DOCUMENT_NOT_VISIBLE` when available.
7. Enter this applicant-facing message:

   `Please upload a clear photo of your national ID.`

8. Confirm the action.

Expected admin result:

- action succeeds
- case leaves the reviewer-action queue
- status becomes `retry_requested`
- a decision and audit event are recorded

## Part C — Applicant refresh

Return to the phone.

1. Tap **Refresh Status**, pull to refresh, or reopen the verification result screen.
2. Confirm all three:

   - **Retake Required**
   - `Please upload a clear photo of your national ID.`
   - **Restart Verification**

Gate 2 passes when all three appear and the cup submission was never shown as verified.

## What to report

Success:

`Gate 2 PASSED — cup was not verified, request resubmission persisted, applicant message and Restart Verification appeared.`

Failure:

`Gate 2 FAILED at step [number] — [exact screen, message and behavior].`

Attach screenshots only when useful. Do not share session tokens, signed URLs or private storage paths.

## Troubleshooting

### Mobile says EXPO_PUBLIC_API_URL is missing

Stop Expo and confirm `mobile/.env.local` exists, then restart:

```bash
cd /private/tmp/carup-phase7c-gate2/mobile
npx expo start --tunnel --clear
```

### Expo QR code does not connect

- confirm the Mac has internet access
- disable VPN temporarily if it blocks Expo tunnel traffic
- update Expo Go
- stop Expo with `Ctrl+C`
- restart with `npx expo start --tunnel --clear`

### Login fails

- confirm the email has no spaces
- use the staging test password shared in owner chat
- confirm the backend health endpoint opens:

  `https://carup-backend-staging-git-release-phase-81c126-pay-pass-project.vercel.app/api/health`

Do not register a new account before confirming the existing account credentials.

### Admin cannot find the case

- sort by newest
- check the pending/manual-review queue
- confirm the applicant email matches the Gate 1 applicant account
- refresh the browser

### Mobile does not show the admin update

- tap Refresh Status
- navigate back into verification results
- fully reload the Expo app if needed
- do not submit another verification until the current session is checked

## Cleanup after Gate 2

Stop Expo with `Ctrl+C`.

Remove local temporary files and worktree:

```bash
rm -f /private/tmp/carup-phase7c-gate2/mobile/.env.local

cd "/Users/shadreckmusarurwa/Project AI/carup-kimi"
git worktree remove /private/tmp/carup-phase7c-gate2 --force
```

MiMo should separately invalidate the temporary Gate 1 staging sessions and remove its `/tmp/carup-phase7c-gate1/` files after owner confirmation.

Do not merge PR #72 or touch production until Gate 2 is confirmed.