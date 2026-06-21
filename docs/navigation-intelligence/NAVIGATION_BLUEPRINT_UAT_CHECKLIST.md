# Navigation Intelligence Blueprint — Product Owner UAT Checklist

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
