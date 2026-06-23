# Navigation Intelligence Blueprint — Product Owner UAT Checklist

> **Automated-equivalent status:** the Playwright suites `tests/agents/27–32` cover
> the desktop menus, footer, public + 7-role mobile drawer, role switching,
> route-boundary direct-access (auth/role/lifecycle), and the admin governance
> console (incl. PATCH/DELETE + non-admin denial) — **38/38 green**. Backend
> role/tenant/audit/version/reset/fail-safe/active-role/sidebar/visibility
> behavior is covered by 35 governance + sidebar/manifest unit tests. Both
> governance migrations are **applied + verified in staging** (`eoyenigwevnxwwhyhaer`)
> and Vercel previews are green; the manual sign-off below runs against the
> deployed staging environment (see staging plan).

Run against **staging** (see `NAVIGATION_BLUEPRINT_STAGING_PLAN.md`).
- **Base URL:** `https://<staging-web-host>` (the `carup-staging` deployment).
- **Credentials:** use the staging QA accounts from `database/seeds/marketplace_v1_staging_qa_accounts.sql` (one per role). **Do not** use production credentials. Obtain passwords from the staging secrets store, not this document.
- Fill **Actual** + **Screenshot** + **Pass/Fail** for each row.

Legend: 🖥 desktop ≥1024px · 📱 phone ≤430px · 🪟 tablet 768–1024px.

## A. Desktop top navigation (🖥)
| # | Step | Expected | Actual | Shot | P/F |
|---|---|---|---|---|---|
| A1 | Open Buy menu | Four sections (Vehicles, Popular Categories, Buyer Tools, Trust Guide) render | | | |
| A2 | Click "Toyota" | Navigates to `/marketplace?make=Toyota` | | | |
| A3 | Click "Under $5,000" | `/marketplace?maxPrice=5000` | | | |
| A4 | Observe "SUVs"/"Engines" | Shown muted with "Soon" (planned), not clickable | | | |
| A5 | Observe "Passport Verified Cars" with no coverage | Defers to `/marketplace` (no `?tag=passport_verified`) | | | |
| A6 | Open Sell as guest, click "Sell Your Car" | Goes to `/register` | | | |
| A7 | Open Sell as owner | "Dealer Listing" absent (owner); present for dealer → `/dealer/inventory` | | | |
| A8 | Open Verify / Parts / More | All sections render; More lists Insurance/Pricing/Diaspora/Trust/Help/Contact/Blog | | | |
| A9 | Keyboard: open a menu, press Escape | Menu closes; focus returns to trigger | | | |

## B. Desktop footer (🖥)
| # | Step | Expected | Actual | Shot | P/F |
|---|---|---|---|---|---|
| B1 | Footer columns | Product, Company, Resources, Stakeholders present | | | |
| B2 | Stakeholders | Owners/Dealers/Mechanics/Insurance/Government/Bankers; **no Admin** | | | |
| B3 | Legal links (bottom bar) | Privacy + Terms present | | | |
| B4 | Social icons | Labelled (aria), disabled "coming soon" (no `href="#"`) until configured | | | |

## C. Public mobile drawer (📱)
| # | Step | Expected | Actual | Shot | P/F |
|---|---|---|---|---|---|
| C1 | Tap hamburger | Drawer opens (focus moves in); Browse links + Sign In/Create account | | | |
| C2 | Press Escape | Drawer closes; focus returns to hamburger | | | |
| C3 | Tap a link | Navigates and drawer closes | | | |
| C4 | Current route | Marked active (aria-current) | | | |

## D. Seven authenticated roles (sign in as each)
For owner, dealer, mechanic, insurance, government, admin, bank:
| # | Step | Expected | Actual | Shot | P/F |
|---|---|---|---|---|---|
| D1 | Dashboard sidebar | Only that role's items; correct dashboard root | | | |
| D2 | Mobile drawer (📱) on a public page while signed in | Shows that role's items under "Your Dashboard"; **no other role's items** | | | |
| D3 | Role switch (user menu / drawer) | Switches portal; items refresh | | | |
| D4 | Logout | Protected items cleared; returns to public | | | |

## E. Lifecycle & direct access
| # | Step | Expected | Actual | Shot | P/F |
|---|---|---|---|---|---|
| E1 | Visit a protected route while logged out (e.g. `/dashboard/garage`) | Redirect to `/login?returnTo=%2Fdashboard%2Fgarage` | | | |
| E2 | Log in from E1 | Returns to the original route | | | |
| E3 | Wrong role visits another role's route (e.g. dealer → `/dashboard`) | Redirect to own dashboard | | | |
| E4 | Unknown URL (e.g. `/nope`) | Not-found page (not blank) | | | |
| E5 | Admin sets a feature → `disabled` (staging) | Its route shows the unavailable page; it leaves the nav | | | |
| E6 | Admin sets a feature → `beta` | Beta notice shown above its content | | | |
| E7 | Admin sets a deprecated target | Visiting the route redirects to the target | | | |

## F. Admin Feature Governance Console (admin)
| # | Step | Expected | Actual | Shot | P/F |
|---|---|---|---|---|---|
| F1 | Open `/admin/features` | Table of features with static + effective lifecycle, override status | | | |
| F2 | Search / filter (lifecycle, domain, override) | Rows filter correctly | | | |
| F3 | Open a feature → detail | Static metadata, immutable role bound, surfaces, current override, audit | | | |
| F4 | Edit roles | Roles outside the immutable bound are disabled (cannot broaden) | | | |
| F5 | Save | Before/after confirmation shown; on accept, override persists; toast | | | |
| F6 | Observe navigation | Nav/route reflect the override after refresh | | | |
| F7 | View audit | The change appears in audit history | | | |
| F8 | Reset to default | Confirmation; feature returns to static default | | | |
| F9 | Non-admin opens `/admin/features` | Redirected away (denied) | | | |
| F10 | Version conflict (edit a stale row) | Conflict message; no silent overwrite | | | |

## G. Cross-cutting
| # | Step | Expected | Actual | Shot | P/F |
|---|---|---|---|---|---|
| G1 | Refresh / back / forward on deep links | State preserved; no stale drawer | | | |
| G2 | 📱 / 🪟 / 🖥 transitions | Mobile drawer ↔ desktop mega-menus switch cleanly; no overflow | | | |
| G3 | Keyboard-only pass through main nav + console | All controls reachable; visible focus | | | |

---
**Sign-off:** Product Owner ______________________  Date __________  Result: PASS / PASS-WITH-NOTES / FAIL

## H. Full-Completion (Milestones A–I) — additional UAT (run on staging)
| # | Step | Expected | Actual | Shot | P/F |
|---|---|---|---|---|---|
| H1 | 📱 Native: sign in as owner | Tabs = Dashboard, Marketplace, Garage, Referrals, More; More opens the governed drawer (SafePay) | | | |
| H2 | 📱 Native: sign in as dealer/mechanic/etc. | Only Dashboard + Marketplace tabs (no fabricated work screens); More drawer has no owner-only items | | | |
| H3 | 📱 Native: anonymous | Marketplace tab only; More → Sign in; no protected routes reachable | | | |
| H4 | 📱 Native: logout / role switch | Tabs + drawer refresh to the new identity; protected items cleared on logout | | | |
| H5 | 📱 Native: physical device | App reaches the staging API (no localhost) for auth/nav/marketplace | | | |
| H6 | 🖥 `/admin/features` direct refresh | Loading state → console renders (lazy chunk); non-admin is redirected | | | |
| H7 | 🖥 Console: set a feature to 25% rollout | Same subject sees a stable result across reloads; role/tenant denial still wins; reset → 100% | | | |
| H8 | 🖥 Navigate around, then open admin Analytics | Funnel metrics (impressions/selections/blocked) populate; charts have text fallbacks; no PII | | | |
| H9 | 🖥/📱 Accessibility | Keyboard opens/closes menus + Escape; visible focus; reduced-motion honored; native VoiceOver/TalkBack labels present | | | |
