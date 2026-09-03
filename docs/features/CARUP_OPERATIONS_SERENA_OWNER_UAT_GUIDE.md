# Serena Vehicle Operations — Owner UAT Guide (PR #206)

**Candidate:** feat/operations-control-plane-serena-slice (unmerged; owner approval required)
**Vehicle:** 2016 Nissan Serena Highway Star — GFC27-027051 (the one real Serena; no duplicate exists)
**Frontend preview:** https://carup-staging-git-feat-operations-control-plane-se-00a80a-11-11.vercel.app
**Backend preview:** https://carup-backend-staging-git-feat-operations-control-6e0b93-11-11.vercel.app
**Pairing check:** open `<frontend>/carup-provenance.json` — `commit_sha` must equal the PR head and `unpaired` must be `false`; `<backend>/api/health` must report the same `commit_sha`.

The automated M7 certification ("Operations Serena Staging UAT" workflow) already
drives this journey end-to-end on desktop/tablet/mobile Chromium and uploads
screenshots as run artifacts. This guide is for your human replay.

## 1. Operator view (admin account)

1. Sign in with your staging admin account on the frontend preview.
2. In the sidebar, note the new grouped sections (People / Vehicles & Trust /
   Marketplace / Communications / Growth & Diaspora / Platform). Fraud Queue,
   Dealer Compliance and Governance Review are now reachable again.
3. Open **Evidence Review** and use a Serena row's "Open Vehicle Operations"
   link, or go directly to `/admin/vehicles/GFC27-027051/review`.
4. Verify the workspace tells the truth:
   - the evidence is grouped by canonical life stage (Import / Inspection), and
     each mislabeled row carries an amber "legacy label … canonical meaning
     governs" chip — the BE FORWARD invoice is Import — Commercial invoice, the
     Tanzania T1 is Import — Transit declaration (never a TIP), the CBCA/Cotecna
     certificate is Inspection — Roadworthiness;
   - Seller authority shows the governed decision and the bounded public wording
     ("Seller authority reviewed by CarUp" — never a title/CVR claim);
   - Zimbabwe registration shows the stage as a **Seller statement**
     (arrived — customs pending) with no plate and no TIP fabricated;
   - the requirement matrix says who must act on anything outstanding;
   - there is NO trust-score edit, NO ZIMRA/CVR button, NO admin publish.

## 2. Kingstone view (the real Seller account)

1. Sign in as Kingstone (kayeedee87@gmail.com — its original password is
   untouched; the CI run used a temporary credential and restored the original).
2. My Listings should show the Serena **Published** (the certification run ends
   published). Unpublish/republish from the same card to confirm the round trip.
3. Open the Sell flow for the Serena (`/dashboard/sell-vehicle?vin=GFC27-027051`):
   the registration-stage control is editable (it is the Seller's lifecycle
   claim), while the canonical identity fields stay locked.

## 3. Buyer view (signed out)

1. Search the Marketplace for `GFC27-027051` — one card, real photos.
2. Open the listing: the page must NOT claim locally registered, a plate, a TIP,
   or any ZIMRA/customs confirmation.
3. `GET <backend>/api/vehicles/GFC27-027051/evidence` while signed out: only
   public-safe verified rows appear and no file URL is served for private-bucket
   documents (the passport/invoice/receipt sources stay withheld).
4. Send an inquiry through the listing's inquiry modal; then, as Kingstone,
   confirm it landed in the My Listings inquiry inbox.

## Known truthful limitations

- The PayPal payment receipt has not been uploaded to the Evidence Vault yet
  (it remains in the private Drive pack); Seller Authority was confirmed on the
  relationship + verified purchase-chain basis without it.
- `import_source` still holds the placeholder value `import` (harmless to
  publication/visibility; a later Seller save can state `Japan` truthfully).
- Kingstone's email address is not yet verified and no identity document has
  entered the identity workflow — neither is a publication requirement today.

If any step above shows something different, stop and report it — do not merge.
