-- ============================================================================
-- Marketplace v1 — STAGING QA ROLE ACCOUNTS (PR #73)
-- ----------------------------------------------------------------------------
-- Companion to database/seeds/marketplace_v1_staging_qa_seed.sql (which seeds the
-- 3 public QA listings). This file provisions the three LOGIN-CAPABLE QA role
-- accounts required for role-based staging QA:
--
--   * buyer            qa-buyer-73@staging.carup.local    role = member
--   * seller / owner   qa-seller-73@staging.carup.local   role = owner   (owns the QA listings)
--   * platform admin   qa-admin-73@staging.carup.local    role = admin   (marketplace moderation)
--
-- Shared QA password (all three): CarUpQA!2026
--   Hashes below are real scrypt:salt:hex digests produced by backend/utils/passwordAuth.js
--   (hashPassword), so /api/auth/login authenticates them exactly like any user. The plaintext is
--   documented here intentionally for human QA — these are disposable STAGING-ONLY accounts.
--
--   ⚠️  STAGING ONLY — apply to the CarUp STAGING Supabase project (ref: eoyenigwevnxwwhyhaer).
--       DO NOT run on production (vhmnajoeicasaigiophh). These credentials must never exist there.
--   ⚠️  All rows use ids suffixed '-73' and @staging.carup.local emails — easy to find / remove.
--   ✅  Idempotent: users upsert by id; the seller's password_hash is set via ON CONFLICT DO UPDATE
--       so this can run after marketplace_v1_staging_qa_seed.sql (which created the seller without a
--       password) and back-fill it. Safe to re-run.
--   ✅  No elevation risk: the buyer is role 'member' (no moderation), proving that the role-isolation
--       checks (assertModerator / resolveEffectiveRole) hold when QA logs in as a non-privileged user.
--
-- CLEANUP (remove all QA role accounts + their sessions):
--   delete from user_sessions where user_id in ('qa-staging-buyer-73','qa-staging-admin-73');
--   delete from users         where id      in ('qa-staging-buyer-73','qa-staging-admin-73');
--   -- the seller (qa-staging-seller-73) and its listings are removed by the listings seed's CLEANUP.
-- ============================================================================

-- 1) Buyer — plain authenticated user (no privileged role). Exercises: logged-in inquiry, save,
--    saved-after-refresh, compare, referral attribution. Must NOT be able to moderate.
INSERT INTO users (id, name, email, phone, role, password_hash, join_date)
VALUES (
  'qa-staging-buyer-73', 'QA Staging Buyer', 'qa-buyer-73@staging.carup.local', '+263772000074', 'member',
  'scrypt:b49a3edf8fffa060090abfd15da4f4d4:053883340d52601db2d56e7660f24ffa7411d3c70103f3b64ce9aa894bb8fde1b0fd5be367a440f8595d8afdf2919cf40189f434a0e70b5d39094ff8620ffe28',
  '2026-06-17'
)
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash;

-- 2) Seller / owner — owns the 3 QA listings from marketplace_v1_staging_qa_seed.sql. Exercises:
--    My Listings load, Marketplace inquiries on OWNED listings, seller-safe status. Back-fill the
--    password_hash whether the row already exists (from the listings seed) or not.
INSERT INTO users (id, name, email, phone, role, password_hash, join_date)
VALUES (
  'qa-staging-seller-73', 'QA Staging Seller', 'qa-seller-73@staging.carup.local', '+263772000073', 'owner',
  'scrypt:8fc6cea9ae290f11f2101fa38816f8d5:85e9129df43b4a2c05ac275d9a7b0b96f1f7028beb4ee6d49bae0016e901e1b0e06857edb52e175ba6ff7d5c234abf9954e575335e80f4fd773b1660a498c06e',
  '2026-06-17'
)
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash;

-- 3) Platform admin / reviewer — marketplace moderation command center. role 'admin' is in
--    MODERATOR_ROLES (marketplaceModerationService.assertModerator) and REVIEWER_ROLES (routes).
INSERT INTO users (id, name, email, phone, role, password_hash, join_date)
VALUES (
  'qa-staging-admin-73', 'QA Staging Admin', 'qa-admin-73@staging.carup.local', '+263772000075', 'admin',
  'scrypt:0940a2ba15fcf5abd373a1f0d8fc430f:b70af26db23d968815f92db8145c00a1ded3d4bef628f7534739ec42ad53824d4e78f2d35b507e850eb449ba2126b0242f0781d9488d6de625a9d65cce3ecaab',
  '2026-06-17'
)
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash;

-- Verify (expect 3 rows, each with a non-null password_hash and the expected role):
--   select id, role, (password_hash is not null) as has_pw
--   from users where id in ('qa-staging-buyer-73','qa-staging-seller-73','qa-staging-admin-73');
