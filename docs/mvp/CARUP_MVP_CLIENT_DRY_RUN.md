# CarUp Client MVP — Dry-Run Script

**For:** the Owner or a client observer, running the MVP on staging from one exact release candidate.
**Not for:** Production. Nothing in this script touches Production, sends an external message or moves money.
**Candidate:** see [`CARUP_MVP_RELEASE_CONTROL.md`](CARUP_MVP_RELEASE_CONTROL.md) §9 for the exact web URL, backend URL,
APK artifact and APK SHA-256. Every step below must be run against those exact URLs and that exact APK.

> A step's **Expected** column is the acceptance condition. If what you see differs, write down the step number, what
> you saw, the time and a screenshot; do not retry silently. A result that cannot be produced honestly is recorded as
> `BLOCKED` with its reason — it is never worked around.

## 0. Prerequisites

| # | Prerequisite | How to confirm |
|---|---|---|
| P1 | Candidate web URL and backend URL from §9 of the release control | Open `<WEB_URL>/carup-provenance.json`: `commit_sha` equals the candidate SHA and `unpaired` is `false` |
| P2 | Backend health | Open `<BACKEND_URL>/api/health`: `build.commit_sha` = candidate SHA, `database.supabase_project_ref` = `eoyenigwevnxwwhyhaer`, `communications.outbound.kill_switch` = `active`, `external_sends` = `disabled` |
| P3 | Android APK from §9 | `shasum -a 256 <apk>` equals the recorded SHA-256; install on an Android device or emulator |
| P4 | Accounts | A **buyer** account you control; the **seller** account that owns Serena (GFC27-027051, the Owner's Kingstone account); a fresh **garage applicant** account you register in step D; a **platform administrator** account able to complete the step-up re-authentication |
| P5 | Communications | External delivery stays disabled. Replies are in-app only. WhatsApp, SMS, email and push are shown as not available — that is correct for this run |
| P6 | Data | Staging contains test history. Serena GFC27-027051 is the one published, available vehicle. Do not delete or edit other rows |

## A. Public visitor

| # | Action | Expected |
|---|---|---|
| A1 | Open `<WEB_URL>/` (signed out) | Home loads; no error |
| A2 | Marketplace | Serena GFC27-027051 is listed; drafts are not |
| A3 | Open Serena | The same VIN opens in Vehicle Detail with real listing photos |
| A4 | Trust block | "CarUp Trust" shows **60/100 · Moderate trust** and right beside it **Confidence: Low**, **Evidence support: 0 of 7 vehicle facts independently confirmed**, **Connected official sources: 0**, and plain-language known limitations (no internal words, no codes) |
| A5 | Verification rows | Odometer reads **Not evaluated** or **One odometer reading on record** — never "Verified"; no row says Verified unless CarUp's records establish it |
| A6 | Passport | The Passport for the same VIN opens; nothing implies verification from missing evidence |

## B. Buyer

| # | Action | Expected |
|---|---|---|
| B1 | Sign in as the buyer (web or app) | Signed-in Home; session survives a refresh / app restart |
| B2 | Open Serena in the **app** and tap **Message seller** | A composer opens showing the vehicle and seller context, an empty message field, **Send** and **Cancel**. **Nothing is sent yet** |
| B3 | Tap **Cancel**, then open the composer again and press Back | Back on the vehicle. No message was created (operator check: no new inquiry row) |
| B4 | Write your own message and tap **Send** once (a quick double tap is fine) | One message is sent — the exact words you typed; the app says it was sent |
| B5 | Open **Inbox** | The conversation for Serena appears (it can take up to about a minute to be prepared) and shows your exact text |
| B6 | Open the thread, then **Open vehicle**, then Android **Back** | Back returns to the same thread, not out of the app |
| B7 | SafePay / transaction status | Shows "No SafePay purchases yet" or your real purchases — never a made-up 0 or a fake payment |
| B8 | Sign out | Signed out; reopening a protected screen asks you to sign in |

## C. Seller (Serena's owner)

| # | Action | Expected |
|---|---|---|
| C1 | My Garage | Serena appears as the same vehicle (same VIN, same photo) with publication state **Published** |
| C2 | My Listings | Serena shows **Published**; inquiries and conversations are counted separately (e.g. "36 inquiries · 33 conversations") |
| C3 | Open Serena in Seller Studio | The Studio says **Published · on the public Marketplace** and explains what saving changes does. It does **not** say draft, private or "not public" |
| C4 | Wait 10 seconds without editing | No "autosave unavailable" message appears (nothing is saved without an edit) |
| C5 | Edit the description and choose **Save changes to public listing** | "Changes saved to your public listing" appears only after CarUp confirms the save; the listing stays published; Marketplace shows the new text |
| C6 | Communications | The buyer's conversation from B4 is there with the exact text; reply in CarUp (in-app only) |

## D. Garage applicant

| # | Action | Expected |
|---|---|---|
| D1 | Register on the web as a business → **Garage / service centre** | Account created; the next step offered is **Continue to your garage application** |
| D2 | Complete the garage application (name, address, phone, services, relationship, attestation, at least one document) and submit | Status **Pending review** with who must act, and a note if identity verification is still needed before approval |

## E. Admin / Operations

| # | Action | Expected |
|---|---|---|
| E1 | Sign in as the platform administrator → Garage applications | The application from D2 is in the queue with the applicant, business type, status, submitted facts, documents you are allowed to see, who must act and decision history |
| E2 | Re-authenticate when asked (step-up) | The decision controls unlock only after re-authentication |
| E3 | **Reject with a reason** (or **Request more information**) | The decision is recorded with your reason; the applicant sees that reason on their garage page |
| E4 | Approve (only if the applicant's identity is genuinely verified) | The garage workspace is created once; if identity is not verified, approval is refused with that reason — this is correct |

## F. Approved service provider

| # | Action | Expected |
|---|---|---|
| F1 | As the approved applicant, open the garage page | **Open your garage** enters the Garage workspace |
| F2 | Public garage profile | Stays private until the profile is completed and published by the garage |
| F3 | Independent mechanic | Not available yet — the app says so and points mechanics to a garage invitation. This is the expected `BLOCKED_MECHANIC_ACTIVATION_MODEL` state |

## G. Tablet communications (900 × 800)

| # | Action | Expected |
|---|---|---|
| G1 | Open Communications at about 900 × 800 | Conversation list and the selected conversation are side by side; the list scrolls on its own |
| G2 | Select a conversation | It is visible without scrolling past the whole list; the composer is reachable; identities are not cut off |
| G3 | Phone width | List first; selecting a conversation opens it with **Back to conversations** |

## H. Native resilience

| # | Action | Expected |
|---|---|---|
| H1 | Marketplace → vehicle → Android Back | Returns to Marketplace (app does not close) |
| H2 | Verify → vehicle → Android Back | Returns to Verify |
| H3 | Force-close and reopen the app | A dark CarUp startup screen appears at once (no white screen), then Home; if the connection is slow a "Still connecting" state with Try again appears instead of a blank screen |
| H4 | Header control | Labelled **Inbox** and opens Inbox; its number counts conversations with unread messages |
| H5 | Sign out, then restart the app | The app stays signed out |

## I. Trade / container co-loading

| # | Action | Expected |
|---|---|---|
| I1 | Open container sailings | Only sailings that are still bookable can be booked; sailings that have already departed are not offered |
| I2 | A sailing whose booking cut-off has passed | Shows "Booking closed — the cut-off passed on <date>"; a reservation is refused |

## J. Safety confirmations

| # | Check | Expected |
|---|---|---|
| J1 | Production | Untouched (no Production URL is used anywhere in this script) |
| J2 | Role escalation | No screen lets a user choose their own role, tenant or approval |
| J3 | External messages | None sent (kill switch active; channels shown as not available) |
| J4 | Payments / ownership transfer | No real payment and no ownership transfer are performed. If a step would require a real transaction or ownership object that does not exist, record `BLOCKED_NO_REAL_STAGING_OBJECT` |
