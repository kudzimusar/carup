# CarUp Referral Engine — Manual Test Data & Paste-In Checklist

**Purpose:** create safe, realistic test records for the merged Referral Engine UI (Phases A–E on `main`) and give exact values to paste into each form.
**Approach:** the data is seeded **through the real admin UI** (so every record has a correct, service-produced shape — no hand-written SQL, no schema change, no fake rows). Records that can't be typed (the wallet benefit) are produced by the real reward flow (qualify a lead with a reward).

> Nothing here was executed against a live database — follow the steps in your local/staging environment. No app code, schema, or stash was touched.

---

## 0. Prerequisites

> ⚠️ **Two separate accounts are required.** You cannot log in as the owner and
> switch to admin: `/api/auth/switch-role` only grants a role already verified for
> your user context, and **admin can only be assumed when `users.role === 'admin'`**
> (the tenant-role path explicitly excludes admin). Switching owner→admin returns
> *"Forbidden. Role 'admin' is not verified for this user context."* — by design.
> So use a dedicated admin account and a dedicated owner account.

1. **Seed the two UAT accounts (staging only).** Passwords come ONLY from your shell env
   (never committed/printed). In a shell that has the **staging** `SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY`, choose two unique strong passwords and run:
   ```bash
   UAT_SEED_CONFIRM=yes \
   UAT_OWNER_PASSWORD='<strong unique>' UAT_ADMIN_PASSWORD='<strong unique>' \
   node backend/scripts/seed-uat-referral-users.mjs
   ```
   This upserts two accounts (idempotent; refuses `NODE_ENV=production`, requires
   `UAT_SEED_CONFIRM=yes`, targets only the staging Supabase ref and refuses production,
   and rejects missing/weak/duplicate passwords before any DB write). It prints only the
   emails, roles, and the owner's user id — **never a password**:

   | Role | Email | Password | Reaches |
   |---|---|---|---|
   | **admin** | `uat-admin@carup.local` | *(env: `UAT_ADMIN_PASSWORD`)* | `/admin/referrals*` |
   | **owner** | `uat-owner@carup.local` | *(env: `UAT_OWNER_PASSWORD`)* | `/dashboard/referrals` |

   > ⚠️ The previously documented UAT passwords are **compromised** and were removed. Rotate both
   > accounts by re-running the seed with fresh env-supplied passwords before any QA.
2. **Log in normally at `/login`** with each account (no role switching anywhere).
3. **`<OWNER_USER_ID>`** = the owner id the seed prints. (Alternatively: log in as the
   owner, open **DevTools → Network**, trigger any `/api/...` call, and copy the
   **`x-user-id`** request header.) Use it when the **admin** creates the bundle in step 3.
4. All admin surfaces live under **`/admin/referrals*`** (admin account); the owner
   surface is **`/dashboard/referrals`** (owner account).

### Identifiers to capture as you go
| Token | How you get it | Example |
|---|---|---|
| `<OWNER_USER_ID>` | printed by the seed script (or `x-user-id` header) | `u_1a2b3c4d…` |
| `<CAMPAIGN_ID>` | from the campaign you create (step 1) | copy from Campaigns list / success |
| `<BUNDLE_CODE>` | from "Bundle created. code: …" (step 3) | `carup-owner-reward-test-…` |
| `<LEAD_EVENT_ID>` | from "Lead created. event_id: …" (step 4) | `referral_events-…` |
| `<ROUTE_KEY>` | from "Route created. route_key: …" (step 6) | `japan-zimbabwe-vehicle-import` |
| `<CONTAINER_ROUTE_KEY>` | from "Route created. route_key: …" (step 7) | `japan-zimbabwe-container-space` |
| `<IMPORT_LEAD_EVENT_ID>` | from import "Lead created. event_id: …" (step 8) | `referral_events-…` |
| `<DISPUTE_EVENT_ID>` | from the Disputes list / "Dispute opened…" (step 12) | `referral_events-…` |

---

## 1. Referral Campaign  →  `/admin/referrals`  (record: campaign)

Form **Create Campaign**:
- **Campaign name \***: `CarUp Referral Test — Local`
- **type**: `LOCAL_MARKETPLACE`
- **scope**: `LOCAL`
- Click **Create**.

✅ Expect: *"Campaign created."* and the row appears in the **Campaigns** list. Copy its id as `<CAMPAIGN_ID>` (or just note the name).
Change the row's status dropdown to `ACTIVE` to test the PATCH (expect the badge to update).
❌ Failure to try: blank name → *"Campaign name is required."*

---

## 2. Referral Code + Coupon  →  `/admin/referrals/codes`  (records: code, coupon, share assets)

**Create Referral Code:**
- **type**: `CAMPAIGN`
- **Custom code (optional…)**: `TESTLOCAL2026`
- **Campaign id (optional)**: `<CAMPAIGN_ID>`
- Click **Create Code** → ✅ *"Code created: TESTLOCAL2026"*. It appears in the **Referral Codes** list.

**Validate Code:**
- **Code to validate**: `TESTLOCAL2026` → **Validate** → ✅ green *"Code is valid."*
- Try `NONEXISTENT` → ❌ red *"Code is not valid."*

**Create Coupon:**
- **discount type**: `PERCENT`
- **Discount value**: `10`
- **Custom coupon code (optional)**: `WELCOME10`
- **Create Coupon** → ✅ *"Coupon created: WELCOME10"*. It appears in the **Coupons** list.

**Apply / Redeem Coupon:**
- **Coupon code**: `WELCOME10`, **Order amount**: `100` → **Apply** → ✅ *"Applied. Discount: 10"* (a 10% coupon on 100).
- **Redeemer user id**: `walkin-buyer-77` → **Redeem for user** → ✅ *"Coupon redeemed."*

**Generate Share Assets:**
- **Code to generate assets for**: `TESTLOCAL2026` → **Generate** → ✅ links (short URL, WhatsApp/Telegram/social), QR text, a barcode image, and poster text render.

---

## 3. Owner-owned Referral Bundle  →  `/admin/referrals/local-leads`  (records: campaign+code owned by the owner — enables the wallet reward)

> The plain Create-Code form can't set an owner, so the **reward-bearing** code comes from the bundle.

Form **Create Referral Bundle**:
- **Owner user id \***: `<OWNER_USER_ID>`
- **Campaign name (optional)**: `CarUp Owner Reward Test`
- Click **Create Bundle** → ✅ *"Bundle created. code: …"* — **copy that code as `<BUNDLE_CODE>`**.
❌ Failure to try: blank owner id → *"owner_user_id is required."*

---

## 4. Local Marketplace Lead  →  `/admin/referrals/local-leads`  (record: local lead)

**Classify Intent** (optional sanity check):
- textarea: `I want to buy a Toyota Aqua in Harare` → **Classify** → ✅ *"Flow: buy_vehicle · Participant: …"*

**Create Lead:**
- **Referral code (optional)**: `<BUNDLE_CODE>`
- **Make**: `Toyota`
- **Model**: `Aqua`
- **Create Lead** → ✅ *"Lead created. event_id: …"* — **copy as `<LEAD_EVENT_ID>`**. It appears in the **Local Marketplace Leads** list.

---

## 5. Qualify the Lead → creates the Wallet Transaction  →  `/admin/referrals/local-leads`  (record: wallet transaction)

Form **Qualify Lead**:
- **lead_event_id \***: `<LEAD_EVENT_ID>`
- **Milestone \***: `order_paid`   *(rewardable; others: `purchase_confirmed`, `service_booked`, `quote_accepted`, `listing_paid`, `inspection_paid`)*
- **Reward amount**: `5`
- **Qualify** → ✅ *"Qualified. reward_created: true"*.

➡️ This creates a **pending wallet transaction** of **$5** credited to `<OWNER_USER_ID>` (the bundle code owner). That's the benefit the owner will see in step 11.
❌ Failure to try: a non-rewardable milestone like `just_browsing` → *"Qualified. reward_created: false"* (no reward), or blank milestone → *"lead_event_id and milestone are required."*

---

## 6. Import Route (vehicle)  →  `/admin/referrals/import-routes`  (record: import route)

Form **Create Route**:
- **Origin \***: `Japan`
- **Destination \***: `Zimbabwe`
- **flow**: `vehicle_import`
- **Total capacity**: `8`
- **Unit label**: `vehicles`
- **Create Route** → ✅ *"Route created. route_key: …"* — copy as `<ROUTE_KEY>`. It appears in the **Import Routes** list (`open`, 0/8).

**Check + Update capacity:**
- **route_key**: `<ROUTE_KEY>` → **Check** → ✅ *"Status: open · total: 8 · booked: 0 · available: 8"*
- **New total**: `8`, **New booked**: `8` → **Update Capacity** → list/status now shows `full`.

---

## 7. Container-Space Route  →  `/admin/referrals/import-routes`  (record: container-space route)

Form **Create Route**:
- **Origin \***: `Japan`
- **Destination \***: `Zimbabwe`
- **flow**: `container_space`
- **Total capacity**: `30`
- **Unit label**: `CBM`
- **Create Route** → ✅ copy as `<CONTAINER_ROUTE_KEY>` (shows `open`, 0/30 CBM).

**Container-Space Lead** (Create Import Lead):
- **route_key (optional)**: `<CONTAINER_ROUTE_KEY>`
- **flow**: `container_space`
- **Requested capacity (container-space)**: `5`
- leave **Allow waitlist** unchecked
- **Create Lead** → ✅ *"Lead created. event_id: … · capacity_status: open · waitlisted: false"* — copy as `<IMPORT_LEAD_EVENT_ID>`.
- *Capacity guard test:* set requested capacity above remaining and uncheck waitlist → ❌ backend rejects with a capacity error; re-check **Allow waitlist** → it accepts as waitlisted.

**Qualify import lead** (optional second wallet tx):
- **lead_event_id \***: `<IMPORT_LEAD_EVENT_ID>`, **Milestone \***: `deposit_paid` *(rewardable; others: `booking_confirmed`, `container_space_paid`, `auction_won`, `vehicle_purchased`, `parts_order_paid`, `shipment_booked`)*, **Reward amount**: `10` → **Qualify**.

---

## 8. Marketing Asset  →  `/admin/referrals/marketing`  (record: marketing asset)

Form **Create Draft Assets**:
- **referral_code**: `<BUNDLE_CODE>`  *(or **campaign_id**: `<CAMPAIGN_ID>`)*
- **base_url (https://…)**: `https://carup.co.zw`
- Click **Campaign Kit** → ✅ *"Campaign kit created."* — several draft assets appear in **Marketing Assets**.

**Status workflow** on a `draft` asset row:
- status `review` → **Apply** → ✅ *"Status updated."*
- status `approved` → **Apply**
- status `scheduled` → a date-time field appears (pick any future time) → **Apply**
- status `published` (optional `public_url`) → **Apply**
- ❌ illegal jump test: on a `draft`, pick `published` → **Apply** → backend rejects with a transition error.
- Disclosure/canonical/UTM flags show under each asset; you cannot strip them (the patch never sends disclosure/attribution).

---

## 9. Trust Risk Check + Review Case  →  `/admin/referrals/trust`  (record: trust review case)

**Run Risk Check:**
- **target_id (user/code)**: `<BUNDLE_CODE>`
- **wallet_transaction_id (optional)**: leave blank
- **duplicate_account_count (optional)**: `3`
- **Run** → ✅ *"Recommendation: review · score: … · critical: false"* (more dup accounts → `hold`/`reject`).
- **Open Review Case** → it appears in **Review Cases**.

**Decide** the case row:
- decision `hold`, **reason (required)**: `Manual hold — duplicate account signals` → **Decide** → ✅ *"Decision recorded."*
- ❌ Failure to try: empty reason → *"A reason is required for every decision."*

**Wallet hold / Explain** (optional, needs a real wallet_transaction_id — see step 11 to read one):
- These are exercised once you have a transaction id from the owner wallet.

**Audit Export:** **Export Audit Trail** → ✅ *"Exported N events · checksum …"*.

---

## 10. Identify the test users  (records: owner user, admin user)

- **Owner user** = the seeded `uat-owner@carup.local` account (role `owner`). Its id is `<OWNER_USER_ID>` (the wallet owner from step 3/5).
- **Admin user** = the seeded `uat-admin@carup.local` account (role `admin`), logged in **directly via `/login`** — not by switching from the owner. Confirm by visiting `/admin/referrals` — the six referral items must be visible in the sidebar (admin-gated).

---

## 11. Owner verification  →  `/dashboard/referrals`  (verify wallet + dispute)

Log in as the **owner** account (`uat-owner@carup.local`) and open **Refer & Earn**:
- **Benefit Wallet** shows **Pending = $5** (from step 5; **$15** if you also qualified the import lead). Approved/Settled stay $0 (benefits never mature on signup — they wait for operator approval).
- On the pending transaction click **"Why?"** → ✅ an explanation like *"This benefit is pending because CarUp must verify…"*.
- **Validate & Share a Code**: enter `<BUNDLE_CODE>` → **Validate** → ✅ *"This referral code is valid."*; **Create Share Kit** → a copyable link appears.
- **Dispute a Benefit** (record: dispute): in the dropdown select the **$5 reward** transaction, reason `Benefit not received yet` → **File Dispute** → ✅ *"Dispute filed. A reviewer will look into it."*

---

## 12. Resolve the dispute  →  `/admin/referrals/trust`  (verify Phase E disputes list)

Log in as the **admin** account (`uat-admin@carup.local`), open **Referral Trust**:
- The **Disputes** list now shows the owner's dispute with its **`dispute_event_id`** — copy it as `<DISPUTE_EVENT_ID>`.
- In **Disputes → Resolve**: **dispute_event_id** `<DISPUTE_EVENT_ID>`, outcome `resolved_upheld`, **reason (required)** `Verified — benefit will be released on approval` → **Resolve Dispute** → ✅ *"Dispute resolved."*
- Refresh the **Disputes** list → status now reads `resolved_upheld`.
- ❌ Failure to try: empty reason → *"dispute_event_id and a reason are required."*

---

## Record coverage map (all 12)

| # | Record | Created in | Lives as |
|---|---|---|---|
| 1 | owner user | step 0/10 (your account, owner role) | auth user (`<OWNER_USER_ID>`) |
| 2 | admin user | step 0/10 (same account, admin role) | auth user |
| 3 | referral campaign | step 1 (+ bundle in step 3) | `referral_campaigns` |
| 4 | referral code | step 2 (`TESTLOCAL2026`) + step 3 (`<BUNDLE_CODE>`) | `referral_codes` |
| 5 | coupon | step 2 (`WELCOME10`) | `referral_coupons` |
| 6 | local marketplace lead | step 4 | `referral_events` (lead_created) |
| 7 | import route | step 6 (`<ROUTE_KEY>`) | `referral_events` (route_page_created) |
| 8 | container-space route | step 7 (`<CONTAINER_ROUTE_KEY>`) | `referral_events` |
| 9 | wallet transaction | step 5 (qualify w/ reward) | `referral_wallet_transactions` (pending) |
| 10 | marketing asset | step 8 | `referral_events` (asset_drafted) |
| 11 | trust review case | step 9 | `referral_events` (review_case_created) |
| 12 | dispute | step 11 (owner files) + step 12 (resolve) | `referral_events` (dispute_created) |

---

## Notes & safety
- **Tenant scoping:** everything is created under your account's tenant; the Phase E lists are tenant-scoped, so you only see your own test rows.
- **No maturation risk:** rewards are created `pending` and never mature from signup — they require operator approval, by design.
- **Cleanup:** these are ordinary referral rows in your local/staging DB. To remove them, delete by the captured ids in `referral_*` tables (or reset your local/staging data). Do not run cleanup against production.
- **Self-referral:** the reward credits the code owner; keep any "Redeemer user id"/referred ids different from `<OWNER_USER_ID>` (the UI/back end block self-referral anyway).
