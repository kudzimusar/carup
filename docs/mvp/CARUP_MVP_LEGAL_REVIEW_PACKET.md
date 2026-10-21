# CarUp Client MVP — Legal & Governance Review Packet

**Gate:** MSCS-VAP GATE-F (Governance: privacy, legal, regulatory, audit, mandatory external obligations)
**Current gate value:** `LEGAL_RELEASE_GATE = BLOCKED_OWNER_LEGAL_APPROVAL`
**Effect:** Production release readiness stays `BLOCKED`. Client-demo readiness on staging is a separate field and is not
affected by this gate (see [`CARUP_MVP_RELEASE_CONTROL.md`](CARUP_MVP_RELEASE_CONTROL.md) §5).

This packet lists the decisions that only the Owner and appropriate legal review can make. It does not propose legal
text, does not infer approval, and does not change the published pages. Both `/terms` and `/privacy` deliberately carry
the badge **"Draft — owner/legal approval required"** and that badge stays.

## 1. Current published posture (source of truth)

| Page | Source | What it states today |
|---|---|---|
| `/terms` | [`web/src/pages/TermsOfService.tsx`](../../web/src/pages/TermsOfService.tsx) | No final commercial or legal terms are published; fees, partner relationships, service levels, legal-contact identities and enforcement outcomes are deliberately withheld until approved |
| `/privacy` | [`web/src/pages/PrivacyPolicy.tsx`](../../web/src/pages/PrivacyPolicy.tsx) | Describes the technical posture only; retention, deletion, anonymization, legal hold, data-subject requests, consent, privacy contact and jurisdiction-specific policy "require owner/legal approval and an implemented workflow" |

## 2. Unresolved decisions

| # | Topic | Open question for the Owner / legal review | Where the product depends on it | Current truthful product state |
|---|---|---|---|---|
| L1 | Commercial / fee model | Which fees exist (listing, subscription, commission, transaction, SafePay/escrow, container co-loading), who pays them, when they are charged, and the grace/suspension rules | Seller listing, Trade/Container reservations, SafePay | No fee is presented as contractual; sandbox/test payment states are labelled as not contractual |
| L2 | Governing law / jurisdiction | Which jurisdiction governs the terms (e.g. Zimbabwe, the operating entity's home jurisdiction, or per-market terms) and the dispute forum | Terms acceptance at registration; marketplace disputes | Not stated |
| L3 | Cancellation / refund position | Buyer and seller cancellation rights, refund rules for any paid service, reservation release rules | Reservations, Trade/Container bookings, SafePay | Not stated; no paid capability is presented as live |
| L4 | Legal contact | The named legal entity and the legal-contact identity/address | Terms page, notices | Withheld; `/contact` is the only route |
| L5 | Privacy contact | The privacy contact (and whether a DPO or equivalent is designated) | Privacy page, data-subject requests | Withheld |
| L6 | Retention / deletion | Retention periods per data class (accounts, sessions, inquiries and conversations, evidence documents, audit ledger, OCR candidates) and the deletion/anonymization rule | Communications, Evidence Vault, audit ledger | Not stated; the product preserves records (supersede/attribute rather than delete) |
| L7 | Data-subject requests | Access, correction, deletion, portability and objection workflow, response time, identity proofing | Account, Privacy page | No self-service workflow is claimed |
| L8 | Consent | What consent is collected at registration (terms, privacy, marketing), how it is versioned and withdrawn; whether Native registration must show an explicit consent control (finding carried from OC-NATIVE-FINAL-02-R1: Native register has no consent checkbox) | Web/Native registration; marketing preferences | Registration records `terms_acknowledged_at` / `privacy_acknowledged_at` on `user_registration_profiles` (staging, 2026-10-21: 90 of 90 profiles carry both; 4 opted into marketing). Whether that acknowledgement is legally sufficient consent, and Native's explicit consent control, are open |
| L9 | Processor / provider language | Which processors/sub-processors may be named (hosting, database, messaging providers such as Meta WhatsApp, Telegram, email providers, OCR/AI providers) and the cross-border transfer statement | Privacy page; Communications channel readiness | No provider is presented as a partner; channels the runtime cannot deliver are not offered as operational |

## 3. What would clear the gate

1. The Owner approves the commercial model (L1, L3).
2. Legal review approves the operative Terms and Privacy text including L2, L4–L9.
3. The approved text is published, the Draft badges are removed in the same change, and the change is verified on the
   exact Production candidate (VAP §20: customer-facing normative documents are not "documentation-only").

Until then: `LEGAL_RELEASE_GATE = BLOCKED_OWNER_LEGAL_APPROVAL`, `PRODUCTION_RELEASE_READINESS = BLOCKED`.
