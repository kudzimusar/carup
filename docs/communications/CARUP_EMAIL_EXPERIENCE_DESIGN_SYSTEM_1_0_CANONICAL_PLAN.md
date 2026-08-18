# CARUP EMAIL EXPERIENCE & DESIGN SYSTEM 1.0 — CANONICAL PLAN

**Programme:** CarUp Kimi — Post-Reunification Functional Gap Closure  
**Workstream:** Communications — Customer Email Experience  
**Status:** **PROPOSED CANONICAL PLAN — REVIEW REQUIRED — IMPLEMENTATION NOT YET AUTHORIZED**  
**Repository:** `kudzimusar/carup`  
**Canonical base when this plan was written:** `main@940c22353fbd759652791bf1c286812856092f85`  
**Transport foundation:** CarUp Email 1.0 merged through PR #163  
**Date:** 2026-08-18

---

## 0. Governing instruction

This document defines the canonical product, design, content, engineering, governance, testing, and rollout plan for **CarUp Email Experience & Design System 1.0**.

It exists because Email 1.0 solved the transport and trust infrastructure, but customer-facing Email presentation is not yet at the standard CarUp intends to represent in the market.

The programme objective is not merely to make emails “look nicer.” The objective is to make Email a first-class CarUp product surface that is:

- immediately recognizable as CarUp;
- professionally designed and consistent across every stakeholder journey;
- appropriate to the purpose of the specific message;
- trustworthy enough for security, payments, Vehicle Passport, SafeTrade, finance, insurance, marketplace and regulatory communication;
- useful enough that recipients actively want to open recurring CarUp messages;
- accessible and robust across modern email clients;
- compliant with consent, unsubscribe and suppression policy;
- structurally connected to CarUp’s product ecosystem rather than behaving like disconnected notification text;
- credible as communication from a real company with a real mission, accountable teams and visible leadership;
- scalable to future high-quality editorial products such as **CarUp Weekly / Weekly Car Highlights**.

### 0.1 Canonical relationship to Email 1.0

This plan sits **on top of** the already-certified Email 1.0 architecture.

It MUST NOT reopen or replace the transport architecture.

The following invariants remain frozen unless a separate owner-approved architecture amendment changes them:

```text
CARUP                    canonical communication / consent / template authority
RESEND                   security + transactional + conversational + service transport
BREVO                    marketing transport only
CLOUDFLARE               authoritative DNS + human alias routing + bounded security edge
mail.carup.dev            Resend sending / receiving domain
marketing.carup.dev       Brevo marketing domain
carup.dev                 canonical production web origin
staging.carup.dev         canonical staging web origin
api.carup.dev             production API — currently DNS-only
api-staging.carup.dev     staging API — Cloudflare-proxied and certified
PRODUCTION_COMMUNICATIONS INACTIVE until separately authorized
DNSSEC                    remains a separate future activation decision
```

The design system MUST use the existing canonical Communications, preference, consent, suppression, notification, delivery-attempt, inbound-reply, webhook and provider machinery rather than creating a parallel email application.

### 0.2 Live-truth rule

At implementation time, agents MUST reconcile this plan against live `main`, live schema, live template records, current provider configuration, canonical staging runtimes and current brand assets.

Live evidence may correct stale implementation details, but it MUST NOT silently change the intent, experience principles or product boundaries of this canonical plan.

If live evidence requires a material design/architecture deviation, the agent MUST document the conflict and request an explicit plan amendment rather than inventing a competing system.

### 0.3 Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are intentional.

- **MUST / MUST NOT** = release requirement.
- **SHOULD / SHOULD NOT** = strong default; deviation requires evidence.
- **MAY** = optional where useful.

---

# 1. Why this programme exists

CarUp Email 1.0 proved that CarUp can securely send, receive, route, reconcile, suppress and audit Email. It also exposed a presentation gap.

Several current messages still look like engineered system output rather than communication from a premium automotive trust platform. A technically correct message that arrives as a sparse text block can still create the wrong recipient perception:

- “Is this really CarUp?”
- “Why does this look unfinished?”
- “Is this safe to click?”
- “Who is behind this company?”
- “How do I contact someone?”
- “Why did I receive this?”
- “Where do I manage what CarUp sends me?”

By contrast, mature consumer and SaaS email programmes establish legitimacy through a combination of visible brand identity, hierarchy, media, useful content, recognizable senders, responsible contact routes, preference controls, organizational context and consistent design.

CarUp’s target is to become a benchmark in this category — not by copying any specific company, but by adopting and exceeding the underlying quality principles.

## 1.1 The benchmark principle

Every CarUp email MUST answer, within a fast visual scan:

1. **Who sent this?**
2. **Why did I receive it?**
3. **What happened / what is this about?**
4. **What should I do next?**
5. **Why can I trust it?**
6. **How do I get help?**
7. **How do I control future messages where applicable?**

If the recipient cannot answer those questions quickly, the email is not production-quality regardless of whether the provider reports `delivered`.

## 1.2 The recognition test

A production template SHOULD pass this test:

> If the visible sender name were temporarily hidden, could a regular CarUp user still recognize the message as CarUp from its layout, tone, color, typography, trust language, footer, navigation and contextual components?

For core template families, the expected answer is **yes**.

---

# 2. Programme goals

Email Experience 1.0 MUST deliver all of the following.

## 2.1 Brand consistency

CarUp must have one recognizable email identity across security, conversations, transactions, trust/service, marketing/editorial and leadership/lifecycle communication.

Consistency does **not** mean every email looks identical. It means every email shares the same brand DNA while adapting appropriately to its task.

## 2.2 Purpose-specific design

A password-reset email MUST feel secure.

A buyer/seller conversation email MUST feel human and contextual.

A SafeTrade transaction email MUST feel structured, factual and financially trustworthy.

A Vehicle Passport update MUST communicate evidence and trust.

A weekly vehicle newsletter MUST feel editorial, visual and worth opening.

A CEO welcome email MUST feel personal, purposeful and human.

One generic template with different text is explicitly insufficient.

## 2.3 Institutional credibility

Emails MUST present CarUp as a real institution with accountable functions, including where appropriate:

- CarUp Security;
- CarUp Trust & Safety;
- CarUp Marketplace;
- CarUp Vehicle Passport;
- CarUp SafeTrade;
- CarUp Support;
- CarUp Garage Network;
- CarUp PartSentry;
- CarUp Weekly;
- named executive leadership for selected lifecycle/vision communication.

## 2.4 Useful recurring communication

Marketing/editorial email must provide enough relevance and value that recipients choose to continue receiving it.

The flagship recurring product will include **Weekly Car Highlights / CarUp Weekly**, with vehicle media, trust information, useful automotive insight, saved-search context and clear preference controls.

## 2.5 Strong recipient trust

Visual trust and technical trust must reinforce one another.

Technical trust already includes SPF, DKIM, DMARC, signed webhooks, canonical links, consent, suppression, deduplication and provider governance.

This programme adds human-facing trust through recognizable design, correct senders, clear contact routes, honest explanation, consistent language and transparent preferences.

## 2.6 Scale without template drift

Agents MUST NOT create one-off visual systems per feature.

The final implementation must provide reusable layouts, components, content rules and a central template registry so future email development automatically inherits CarUp standards.

---

# 3. Non-goals and protected boundaries

This programme MUST NOT:

- replace Resend or Brevo;
- reopen Email 1.0 routing architecture;
- create provider-owned customer state;
- create a separate `email_users`, `email_messages`, `email_threads` or parallel consent system;
- start Telegram work;
- reopen WhatsApp certification;
- activate production Communications;
- proxy `api.carup.dev` as a side effect;
- enable DNSSEC as a side effect;
- invent CEO/founder identity, legal entity name, registered office, physical address, social account or regulatory contact data;
- enable product flows that do not exist merely because a template design exists;
- turn security or transactional emails into promotional newsletters;
- use leadership branding to disguise marketing as essential communication.

---

# 4. Canonical email experience architecture

The Email Experience system has six layers.

```text
1. BRAND FOUNDATION
   logo, colors, type, tagline, corporate descriptor, voice, sender identities

2. EMAIL COMPONENT SYSTEM
   mastheads, buttons, cards, badges, safety panels, signatures, footers, media blocks

3. TEMPLATE FAMILIES
   security, conversations, transactional, service/trust, marketing/editorial,
   leadership/lifecycle

4. CONTENT + DATA CONTRACTS
   personalization, vehicle data, trust data, actions, contact mapping,
   regulated-data minimization

5. RENDERING + DELIVERY INTEGRATION
   canonical Communications -> render -> text/html -> Resend/Brevo

6. CERTIFICATION + GOVERNANCE
   preview, accessibility, client rendering, physical inbox tests, versioning,
   release checklist, ongoing template registry
```

No agent may implement only layer 3 while ignoring the shared foundation and governance layers.

---

# 5. Brand foundation

## 5.1 Brand identity hierarchy

The system must distinguish between:

### Brand name

```text
CarUp
```

### Corporate descriptor

A descriptive line explaining what CarUp is. The current working direction is:

```text
Automotive Intelligence & Trust Network
```

This wording is **provisional until owner-frozen**.

### Consumer payoff / tagline

A shorter emotional line suitable for selected marketing, lifecycle and footer contexts.

The implementation MUST NOT invent this. It requires owner approval before production use.

Possible categories to explore during brand freeze include confidence, trust, vehicle knowledge, journey and ownership, but the final wording is an owner decision.

## 5.2 Leadership identity

Leadership/lifecycle templates require a real, owner-approved public identity.

The system must support:

```text
CEO_DISPLAY_NAME
CEO_PUBLIC_TITLE
CEO_OPTIONAL_SIGNATURE_ASSET
CEO_OPTIONAL_HEADSHOT_ASSET
LEADERSHIP_REPLY_TO
```

No agent may infer the CEO/founder name from repository usernames, account ownership or internal metadata.

The implementation MUST remain blocked from customer-facing named leadership emails until the owner supplies and approves the public name/title/identity.

## 5.3 Legal/institutional identity

Marketing and selected transactional footers require an approved legal identity and, where required by applicable law/provider policy, a physical postal address.

The system must support configurable fields such as:

```text
CARUP_LEGAL_ENTITY_NAME
CARUP_REGISTERED_ADDRESS
CARUP_COUNTRY
CARUP_SUPPORT_URL
CARUP_PRIVACY_URL
CARUP_TERMS_URL
```

These values MUST NOT be fabricated.

## 5.4 Brand colors

The current Email 1.0 security renderer already established a sound accessible base. Email Experience 1.0 should preserve and expand it.

### Canonical core tokens

```text
INK / DEEP NAVY          #0F172A
BODY TEXT                #334155
MUTED TEXT               #64748B
SURFACE                   #FFFFFF
CANVAS / SOFT GRAY       #F1F5F9
BORDER                    #E2E8F0
ACCESSIBLE CTA ORANGE     #C2410C
CTA TEXT                  #FFFFFF
```

### Brand accent orange

The brighter CarUp orange used in product UI MAY be used for:

- logo accent;
- small rules;
- icons;
- labels;
- decorative highlights;
- editorial emphasis.

Bright orange MUST NOT be used behind white body-size text if contrast fails accessibility.

For primary CTA buttons, the deeper accessible orange remains the default unless a tested alternative meets WCAG AA.

### Semantic colors

A limited semantic palette should be standardized for:

- success / verified;
- information;
- caution;
- critical/security alert.

Color MUST never be the only signal. Every semantic state requires text and/or iconography.

## 5.5 Typography

Email must remain resilient across clients.

Default stack:

```text
-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif
```

A custom webfont MUST NOT be required to understand hierarchy or brand identity.

Recommended hierarchy:

```text
Brand mark / masthead     18–22px
Hero / primary heading    26–36px depending on family
Security heading          22–26px
Section heading           18–22px
Body                      15–17px
Metadata / labels         12–14px
Footer                    12–13px
```

Minimum body size SHOULD be 15px on desktop and 16px on mobile when possible.

## 5.6 Layout width

Default content width:

```text
Security / transactional / service     600px
Conversation                            600px
Leadership / lifecycle                  620px
Marketing / editorial                   640px maximum
```

Layouts MUST degrade cleanly to narrow mobile screens.

No customer-facing email may require horizontal scrolling.

---

# 6. Sender persona system

Visible sender identity is a product feature, not an incidental provider setting.

The following canonical persona model governs customer-facing display names.

| Communication family | Preferred visible sender | Default transport | Reply behaviour |
|---|---|---|---|
| Account/security | **CarUp Security** | Resend | monitored security/support path where appropriate; automated messages may explicitly say no reply |
| Conversations | **CarUp Conversations** or context-specific CarUp sender | Resend | canonical `conversation+<opaque>@mail.carup.dev` Reply-To |
| Marketplace transactional | **CarUp Marketplace** | Resend | support or canonical conversation path |
| Vehicle Passport | **CarUp Vehicle Passport** | Resend | support/contextual action |
| SafeTrade | **CarUp SafeTrade** | Resend | support/authenticated transaction surface |
| Trust/fraud | **CarUp Trust & Safety** | Resend | security/trust contact |
| Garage/service | **CarUp Garage Network** | Resend | support/contextual action |
| Parts | **CarUp PartSentry** | Resend | support/contextual action |
| General service | **CarUp** / **CarUp Support** | Resend | support |
| Weekly editorial | **CarUp Weekly** | Brevo | preference/support route |
| General marketing | **CarUp** | Brevo | preference/support route |
| Leadership/lifecycle | **[Approved CEO Name] at CarUp** or **CarUp Leadership** | Resend for service onboarding; Brevo only when the message is truly marketing | monitored human/operational reply target |

## 6.1 Sender-address constraint

Display-name diversity MUST NOT create unnecessary sending domains.

The programme should prefer the already-verified domains and provider allocations. New local-parts may be introduced only when operationally useful and verified, without creating a new provider architecture.

## 6.2 Human sender honesty

A named executive sender MUST NOT imply a directly monitored personal inbox unless that inbox or Reply-To is actually monitored.

If the display name is personal but replies are handled by a team, the email SHOULD explain that replies are handled by the CarUp team or set an appropriate monitored Reply-To.

---

# 7. Recipient personalization

## 7.1 Central name resolver

No template may independently invent how to address a person.

Implementation must provide a central `recipientPresentationName` resolver with deterministic fallbacks.

Preferred order should be based on live available fields, for example:

```text
approved preferred/display name
first/given name
safe parsed full name
no-name greeting
```

Unsafe outcomes such as the following are forbidden:

```text
Hello undefined
Dear null
Welcome MUSARURWA SHADRECK   // raw database formatting leak
```

The no-name fallback should remain natural, for example:

```text
Welcome to CarUp.
Hello,
Your CarUp account…
```

## 7.2 Escaping and injection safety

All dynamic data MUST be escaped appropriately for HTML and text.

User-provided vehicle titles, names, garage names, listing descriptions and message excerpts MUST NOT become raw HTML.

## 7.3 Personalization restraint

CarUp should personalize where it adds relevance, not for novelty.

Useful personalization includes:

- first/preferred name;
- vehicle make/model/year;
- marketplace role;
- saved search;
- Trust Score/evidence context;
- transaction reference;
- onboarding role;
- relevant location.

Sensitive or regulated fields must not be surfaced merely because the database contains them.

---

# 8. Six canonical presentation families

Transport priority and presentation family are related but not identical. The design system uses six presentation families.

---

## 8.1 Family S — Security & Identity

**Typical classifications:** P0 security/authentication  
**Transport:** Resend  
**Tone:** restrained, calm, authoritative, protective  
**Visual emphasis:** institutional identity, security context, one clear action

Examples:

- confirm email;
- password reset;
- password changed;
- account recovery;
- new sign-in/security alert when the capability exists;
- sensitive account change when the capability exists.

### Required elements

1. CarUp Security masthead.
2. Clear security heading.
3. One primary action at most.
4. Expiry/single-use information when relevant.
5. “Didn’t request this?” guidance.
6. Anti-phishing/security reassurance.
7. `security@carup.dev` and/or `support@carup.dev` where useful.
8. Reason-received line.
9. Privacy/Security/Support footer links.
10. No marketing content.

### Security-specific trust language

Approved patterns should include language such as:

- CarUp will never ask you to send your password or recovery code by email.
- Check that CarUp links use the canonical `carup.dev` domain family.
- If you did not request the action, no change will occur unless stated otherwise.

The final copy must remain concise and not frighten users unnecessarily.

---

## 8.2 Family C — Conversations

**Typical classification:** P1 conversational  
**Transport:** Resend  
**Tone:** human, contextual, actionable  
**Visual emphasis:** participant + subject/vehicle/workflow context + reply

Examples:

- marketplace buyer ↔ seller;
- owner ↔ garage;
- parts buyer ↔ seller;
- support threads;
- diaspora import coordination;
- regulated conversations with sensitive detail intentionally omitted.

### Required elements

1. CarUp identity.
2. Conversation context.
3. Participant display name/role where safe.
4. Vehicle/workflow summary where useful.
5. Bounded message excerpt.
6. Primary **Reply** / **View conversation** action.
7. Canonical reply token behaviour from Email 1.0.
8. Safety reminder when money, off-platform contact or evidence is relevant.
9. No sensitive regulated detail in email bodies where the stakeholder matrix marks the workflow regulated.

### Vehicle conversation card

Where the thread relates to a vehicle, the email SHOULD support:

```text
primary vehicle image
make / model / year
price where appropriate
location where appropriate
Trust Score / verification indicator where current and authorized
listing status
```

The card is context, not a full listing page.

---

## 8.3 Family T — Transactional

**Typical classification:** P2 transactional  
**Transport:** Resend  
**Tone:** factual, structured, reassuring  
**Visual emphasis:** status, reference, amount/date/next steps

Examples:

- listing published/unpublished;
- reservation;
- SafeTrade stage changes;
- payment initiated/succeeded/failed/refunded;
- inspection booking;
- work order updates;
- parts order updates;
- document received;
- referral transaction/reward state;
- shipment/container milestones;
- finance/insurance workflow acknowledgements with regulated detail minimized.

### Required elements

1. Product/function identity, e.g. CarUp SafeTrade.
2. Clear state badge.
3. Reference number where applicable.
4. Summary table/card.
5. What happened.
6. What happens next.
7. Primary action to authenticated CarUp surface.
8. Support route.
9. Reason-received footer.

Transactional email MUST NOT become a cross-sell channel by default.

---

## 8.4 Family V — Service, Vehicle Intelligence & Trust

**Typical classification:** P3 service  
**Transport:** Resend  
**Tone:** useful, intelligent, action-oriented  
**Visual emphasis:** insight, evidence, trust, vehicle ownership value

Examples:

- Vehicle Passport created/updated;
- Trust Score movement;
- evidence accepted/rejected;
- inspection result ready;
- service reminder;
- ownership/document reminder;
- PartSentry alert;
- saved-car status update;
- relevant non-promotional price/watchlist alert;
- garage/service status;
- safety/advisory notices.

### Required design capabilities

- metric cards;
- before/after Trust Score presentation;
- evidence checkmarks;
- warning/advisory panels;
- vehicle cards;
- next-best action;
- concise explanation of why the change matters.

Example structure:

```text
Your vehicle trust profile improved

Toyota Hilux
Trust Score 86 -> 91

+ Service history verified
+ Ownership evidence added
+ Inspection evidence confirmed

[ View Vehicle Passport ]

Why this matters
A stronger evidence-backed Passport can increase confidence when the vehicle
is sold, financed, serviced or verified.
```

Trust claims must be generated from canonical, current evidence — never marketing embellishment.

---

## 8.5 Family M — Marketing & Editorial

**Classification:** P4 marketing  
**Transport:** Brevo only  
**Tone:** visual, editorial, useful, energetic, premium  
**Visual emphasis:** media, curation, discovery, brand storytelling

Examples:

- CarUp Weekly;
- Weekly Car Highlights;
- featured vehicles;
- new verified stock;
- curated price drops where the communication is promotional rather than watchlist/service;
- automotive knowledge/editorial;
- diaspora buying guidance;
- product education;
- optional partner promotions where policy permits;
- re-engagement campaigns.

### Mandatory marketing elements

1. Strong CarUp/CarUp Weekly masthead.
2. Recognizable hero/editorial structure.
3. Meaningful content beyond a sales CTA.
4. Approved personalization.
5. Visible preference-management link.
6. Visible unsubscribe link.
7. RFC/provider one-click unsubscribe support as already governed.
8. Reason-received language.
9. Legal entity/postal details once owner-approved.
10. Privacy, Terms and Support links.
11. Branded `marketing.carup.dev` identity/links.

### Marketing quality rule

A marketing email MUST NOT be a list of notification records with a logo at the top.

It must be intentionally edited and designed.

---

## 8.6 Family L — Leadership & Lifecycle

**Typical classification:** one-time P3 service onboarding, or P4 when genuinely promotional  
**Transport:** Resend for non-promotional service onboarding; Brevo for marketing content  
**Tone:** human, purposeful, credible, warm  
**Visual emphasis:** mission, leadership signature, next steps

Examples:

- CEO welcome;
- why CarUp exists;
- role-specific onboarding;
- first-listing milestone;
- first Vehicle Passport milestone;
- first SafeTrade milestone;
- garage onboarding;
- major platform announcement;
- annual community letter;
- major trust/safety commitment.

### Leadership rules

Named leadership SHOULD be used selectively so it retains meaning.

CEO/founder identity SHOULD NOT appear as the signer of:

- password resets;
- OTP/security codes;
- routine payment receipts;
- routine conversation notifications;
- generic price alerts;
- every weekly newsletter.

Those should come from accountable CarUp functions.

### CEO Welcome requirement

A CEO Welcome template is a **reference template and first implementation batch requirement**.

It should include:

1. personal greeting;
2. a short mission statement;
3. why CarUp was built;
4. what makes CarUp more than a marketplace;
5. role-specific “Start here” actions;
6. one primary onboarding CTA;
7. support route;
8. approved leadership signature/title;
9. optional small approved headshot/signature asset;
10. branded institutional footer.

It MUST NOT include unapproved marketing offers if classified as service onboarding.

---

# 9. Welcome and lifecycle journey

Registration should not trigger one overloaded email that mixes authentication, company vision and marketing.

The target journey is staged.

## 9.1 Step 1 — Security / verification

Immediate security message from **CarUp Security**.

Purpose: verify or secure the account.

No CEO commentary, no promotions.

## 9.2 Step 2 — Leadership welcome

After successful verification / safe activation.

Purpose: introduce the company mission and human leadership.

Subject direction:

```text
Welcome to CarUp — a note from our CEO
Welcome to CarUp — why we built it
```

Final subject depends on approved leadership identity and tone.

## 9.3 Step 3 — Role-specific onboarding

Dynamic next steps based on the user’s real role/capabilities.

### Buyer

```text
Browse vehicles
Check Trust Scores / Vehicle Passports
Save vehicles
Create a saved search
Arrange an inspection / use trusted workflow where available
```

### Seller

```text
Create first listing
Add strong media
Add evidence / Vehicle Passport
Improve trust profile
Respond to inquiries
```

### Vehicle owner

```text
Add vehicle
Build Vehicle Passport
Add service/evidence history
Review ownership/trust state
```

### Mechanic / garage

```text
Complete garage profile
Verify business
Add services
Manage work orders
Build reputation
```

### Diaspora customer

```text
Explore appropriate stock
Review import/trade guidance
Use sourcing/RFQ workflows
Track documents and shipment state
```

Only actions physically supported by the live product may be shown.

## 9.4 Milestone communication

The system SHOULD support positive lifecycle messages such as:

- first Vehicle Passport created;
- first listing published;
- first inquiry received;
- first evidence item verified;
- Trust Score milestone;
- first completed SafeTrade journey;
- first completed garage/work-order journey;
- anniversary/community milestone where appropriate.

These should reinforce product value without turning every event into marketing noise.

---

# 10. Canonical component system

Implementation must create reusable components rather than hand-built markup per template.

## 10.1 Structural components

Required:

- hidden preheader;
- email canvas;
- max-width content shell;
- masthead/header;
- category label;
- section header;
- divider;
- primary CTA;
- secondary CTA/text link;
- compact link fallback where required;
- footer variants.

## 10.2 Brand components

Required:

- CarUp logo lockup;
- CarUp wordmark fallback rendered as text if images fail;
- product/function identity label;
- tagline/corporate descriptor component;
- leadership signature block;
- optional leadership image block.

## 10.3 Product-context components

Required or planned:

- vehicle card;
- vehicle hero;
- Trust Score badge;
- verified/evidence badge;
- status badge;
- transaction summary table;
- timeline/next-steps list;
- message excerpt card;
- metric/change card;
- safety/trust notice;
- regulatory-detail-minimization notice;
- saved-search summary;
- recommendation card;
- editorial article card;
- multi-vehicle grid that degrades to single-column mobile.

## 10.4 Footer components

Three canonical footer families are mandatory.

### Security footer

Must support:

```text
security@carup.dev
support@carup.dev
Privacy
Security
Support
anti-phishing guidance
reason-received statement
```

### Transactional/service footer

Must support:

```text
support@carup.dev
relevant product navigation
Privacy
Terms
Support
reason-received statement
```

### Marketing/editorial footer

Must support:

```text
CarUp corporate descriptor
selected ecosystem navigation
Manage preferences
Unsubscribe
Privacy
Terms
Support
legal entity / postal address when approved
optional approved social links
reason-received statement
```

Not all seven human aliases should be dumped into every footer. Contact mapping must follow purpose.

---

# 11. Media and asset architecture

## 11.1 Principle

Media must strengthen context and brand, not decorate every message.

Security emails SHOULD remain restrained.

Editorial, marketplace and Vehicle Passport emails may be media-rich where appropriate.

## 11.2 Stable asset ownership

Email assets MUST be served from stable CarUp-controlled HTTPS URLs.

The first implementation should prefer a canonical CarUp web path, for example a governed `/email-assets/` namespace, rather than adding a new CDN/domain prematurely.

If the asset layer is later moved to a CDN, the public asset contract should remain stable where possible.

## 11.3 Proposed asset organization

```text
email-assets/
  brand/
    logo-dark.png
    logo-light.png
    mark.png
    wordmark.png
  icons/
    verified.png
    shield.png
    passport.png
    safetrade.png
    garage.png
    partsentry.png
  defaults/
    vehicle-placeholder.jpg
    garage-placeholder.jpg
    editorial-placeholder.jpg
  leadership/
    approved-ceo-headshot.jpg        # only after owner approval
    approved-ceo-signature.png       # optional
  editorial/
    weekly/
    education/
```

Exact repository/public paths must be reconciled with existing asset architecture before implementation.

## 11.4 Image requirements

- Use JPEG/PNG formats with broad email-client support as the safe baseline.
- Provide 2x-resolution source assets for crisp rendering where useful.
- Define displayed width/height to reduce layout shift.
- Use meaningful `alt` text.
- Do not make the email incomprehensible when images are blocked.
- Do not embed sensitive/private vehicle evidence as publicly retrievable email images.
- Do not hotlink unstable third-party images.
- Vehicle imagery must come from canonical CarUp-controlled/published media eligible for recipient display.

## 11.5 Vehicle image fallback

If a listing has no eligible primary image, use a branded vehicle placeholder rather than broken-image UI.

## 11.6 Logo resilience

The header SHOULD include a real logo asset but MUST remain recognizable if images are disabled. A text fallback/brand name must remain visible.

---

# 12. CarUp Weekly / Weekly Car Highlights specification

This is a flagship Email Experience 1.0 deliverable.

## 12.1 Purpose

Create a recurring automotive email product that recipients consider useful enough to open voluntarily.

It should combine marketplace discovery, verified vehicle context, ownership/trust intelligence and editorial usefulness.

## 12.2 Candidate sections

The first version should be modular. Possible approved modules include:

```text
FEATURED VEHICLE
BEST VERIFIED VALUE
NEWLY VERIFIED
PRICE DROP / MARKET MOVE
EDITOR'S PICKS
YOUR SAVED SEARCH / WATCHLIST
CARUP KNOWLEDGE
VEHICLE PASSPORT INSIGHT
GARAGE / MAINTENANCE TIP
DIASPORA / IMPORT INSIGHT
```

Not every issue needs every module.

## 12.3 Vehicle-card minimums

Where data is available and approved:

- main image;
- year/make/model;
- price;
- broad location;
- Trust Score or verification state if current and meaningful;
- key provenance indicators;
- primary CTA.

## 12.4 Editorial standard

Weekly email must not simply be “latest 10 listings.”

It should be curated or algorithmically ranked according to an explicit product policy and include useful editorial context.

## 12.5 Consent

CarUp Weekly is marketing/editorial and requires marketing eligibility/consent under the existing authority model.

Unsubscribing from it must not suppress security or required transactional email.

---

# 13. Preference architecture

Email 1.0 established marketing suppression. Email Experience 1.0 should evolve the recipient-facing presentation toward a full preference model without breaking existing consent authority.

Target categories:

```text
ESSENTIAL
  Account security                    always enabled where required
  Required transactions               enabled where necessary to perform service

COMMUNICATION
  Conversation alerts                 configurable
  Vehicle/service activity            configurable

DISCOVERY
  Saved-search updates                configurable
  Price/watchlist alerts              configurable
  Weekly Car Highlights               configurable
  CarUp Weekly                        configurable

OFFERS
  Insurance offers                    opt-in / governed
  Finance offers                      opt-in / governed
  Partner promotions                  opt-in / governed
```

The exact database mapping MUST reconcile existing `communication_preferences`, consent records, suppressions and stakeholder policy before schema changes.

No provider list may become the canonical preference source.

---

# 14. Content design system

## 14.1 Every email needs a purpose statement

Copy should make the purpose immediately clear.

Examples:

- “A password reset was requested for your CarUp account.”
- “Tendai sent you a message about your Toyota Hilux.”
- “Your SafeTrade reservation is confirmed.”
- “New evidence improved your Vehicle Passport trust profile.”
- “You receive CarUp Weekly because you opted into vehicle recommendations.”

## 14.2 Reason-received line

Every template MUST include a meaningful reason-received statement, especially marketing.

## 14.3 Next-best action

Every lifecycle/service/transactional email SHOULD make the next useful CarUp action clear.

The next action must come from actual product state, not generic promotion.

## 14.4 Tone

CarUp email voice should be:

- clear;
- confident;
- respectful;
- calm in security/financial contexts;
- energetic but not spammy in marketing;
- helpful rather than bureaucratic;
- direct rather than jargon-heavy;
- locally relevant where appropriate without forced slang.

## 14.5 Forbidden copy patterns

Avoid:

- “Dear User”; 
- raw internal enum names;
- internal IDs without useful context;
- debug language;
- all-caps urgency except narrowly justified labels;
- multiple exclamation marks;
- fake scarcity;
- misleading “urgent” marketing;
- marketing copy inside security messages;
- provider jargon;
- text that promises a link/button that is not rendered.

## 14.6 Subject and preheader

Subject lines should be specific and human-readable.

### Security

```text
Reset your CarUp password
Confirm your CarUp account
Your CarUp password was changed
```

No marketing emoji or sensational language.

### Transactional

```text
Your SafeTrade reservation is confirmed
Your inspection is booked for Saturday
Your CarUp listing is now published
```

### Service/trust

```text
Your Vehicle Passport trust profile improved
New evidence was added to your vehicle
```

### Marketing/editorial

```text
CarUp Weekly: cars worth knowing this week
7 verified vehicles to watch this week
```

Final copy must be tested for truncation on mobile.

Preheaders must add information rather than repeat the subject verbatim.

---

# 15. Leadership communication standards

## 15.1 Why leadership email exists

CarUp should not feel like a faceless notification engine.

Selected lifecycle moments should communicate that real people are responsible for the vision, values and direction of the company.

## 15.2 Required first leadership template

**CEO Welcome** is mandatory in the first reference batch.

It must communicate:

- welcome;
- mission;
- CarUp’s trust-network vision;
- why CarUp is more than a marketplace;
- what the user can do next;
- a human sign-off.

## 15.3 Leadership signature component

The canonical component should support:

```text
Warm regards,

[Optional signature image]
[CEO name]
Chief Executive Officer
CarUp
[Optional small headshot]
```

Title/name must be owner-approved.

## 15.4 Leadership frequency

Leadership email should be deliberately infrequent.

Overuse reduces credibility and makes the CEO identity feel like a marketing alias.

---

# 16. Regulated and sensitive workflows

The existing stakeholder matrix marks finance, insurance, government/public-service, Trust & Safety and authentication flows as regulated/sensitive.

Email Experience 1.0 MUST preserve data minimization.

For regulated workflows, email should often communicate:

```text
There is an update to your CarUp finance application.
[ Review securely in CarUp ]
```

rather than placing credit decisions, identity evidence, claim detail, registry data or other sensitive information in the email body.

Visual polish MUST NOT cause more sensitive information to be exposed.

---

# 17. Security and anti-phishing presentation

Security is part of design.

## 17.1 Canonical links

Customer-visible durable links MUST use approved CarUp domains.

Production links should use `carup.dev`; staging certification should use `staging.carup.dev` where appropriate.

Do not display `*.vercel.app`, raw provider URLs or non-canonical origins as normal user-facing links.

## 17.2 Link clarity

Buttons should describe the action:

```text
Reset password
View conversation
View Vehicle Passport
Review SafeTrade transaction
Manage preferences
```

Avoid generic “Click here.”

## 17.3 Security fallback URL

Security templates MAY retain a fallback URL for accessibility/client reliability, but the visual design should keep the canonical domain clear and the raw token from dominating the message.

## 17.4 Reply behaviour

Emails that should not be replied to must say so.

Conversation emails must support the canonical opaque Reply-To system.

Leadership/support emails should use a monitored Reply-To if they invite a response.

---

# 18. Deliverability requirements

A beautiful email that gets filtered is a failed product.

Email Experience 1.0 must preserve all Email 1.0 deliverability controls and add presentation-aware rules.

## 18.1 Required technical controls

- SPF/DKIM/DMARC remain valid.
- Provider domains remain canonical.
- Brevo branded marketing links remain intact.
- Marketing unsubscribe remains visible and machine-readable.
- Bounce/complaint/suppression handling remains authoritative in CarUp.
- Dedupe remains database-enforced.
- No hidden paid provider failover.

## 18.2 Content deliverability rules

- No image-only emails.
- Avoid extreme image-to-text imbalance.
- Avoid excessive link density.
- Avoid URL shorteners.
- Avoid attachment-heavy marketing.
- Use meaningful text content even when HTML is present.
- Keep From names stable and recognizable.
- Keep subject lines truthful.
- Do not send marketing to suppressed/non-consented recipients.

## 18.3 Marketing frequency

The system should support frequency governance so recipients are not overwhelmed by separate campaigns from different CarUp features.

Future implementation SHOULD consider a global marketing/contact cadence policy above individual campaign scheduling.

---

# 19. Accessibility requirements

All reference templates MUST meet the following.

- Text contrast WCAG AA where practical.
- Primary CTA contrast at least 4.5:1 for normal text.
- Touch targets approximately 44px high where possible.
- Logical heading hierarchy.
- Meaningful image `alt` text.
- No critical information conveyed only by color.
- Readable with images disabled.
- Readable at 200% browser zoom.
- Mobile body text large enough to avoid forced zoom.
- Link text describes destination/action.
- Tables used for layout are marked presentation-only.
- Decorative images use empty alt text where appropriate.

---

# 20. Dark mode and client resilience

The system must account for client-controlled dark mode.

Requirements:

- avoid transparent logo variants that disappear on dark backgrounds;
- test white and dark logo treatments;
- avoid relying on subtle low-contrast borders only;
- keep CTA contrast under common color inversion behaviour;
- do not make the entire email dependent on CSS unsupported by Outlook;
- inline critical styling;
- table-based layout remains the compatibility baseline.

No template may be certified only from a browser preview.

---

# 21. Rendering implementation architecture

## 21.1 Extend, do not replace

The existing `authEmailTemplates.js` already contains brand tokens, a 600px mobile-safe shell and accessible orange action styling. The implementation should evolve that work into a shared system rather than leaving auth as a separate design island.

## 21.2 Proposed module structure

The exact file structure may be adjusted to fit live repository conventions, but the architectural separation should resemble:

```text
backend/services/communication/emailExperience/
  brandTokens.js
  brandIdentity.js
  recipientPresentation.js
  canonicalEmailLinks.js
  renderEmail.js
  templateRegistry.js
  contentPolicy.js
  mediaPolicy.js
  layouts/
    securityLayout.js
    conversationLayout.js
    transactionalLayout.js
    serviceTrustLayout.js
    editorialLayout.js
    leadershipLayout.js
  components/
    masthead.js
    button.js
    footer.js
    vehicleCard.js
    trustBadge.js
    statusBadge.js
    messageCard.js
    infoPanel.js
    metricCard.js
    leadershipSignature.js
  templates/
    ...
```

## 21.3 Framework rule

Initial implementation SHOULD extend the current deterministic server-side JavaScript rendering approach.

Do not add MJML, React Email or another rendering framework merely because it is fashionable.

A new dependency/framework requires evidence that the current composable renderer cannot satisfy maintainability/client requirements and requires owner-approved amendment.

## 21.4 Plain text is first-class

Every HTML email must have a meaningful plain-text equivalent.

Plain text MUST NOT be an afterthought generated by stripping tags from arbitrary HTML if that results in poor semantics.

## 21.5 Canonical template registry

All customer-facing templates must be registered with metadata such as:

```text
template_key
version
family
classification
sender_persona
provider_transport
workflow
recipient_role
consent_requirement
regulated_data_policy
primary_action
footer_family
media_policy
leadership_identity_required
```

This registry should integrate with the existing `communication_templates` / template-version governance rather than creating a competing template database.

## 21.6 Versioning

Customer-visible template changes that materially change content, legal language, consent semantics or data contracts must produce an auditable version.

Pure CSS/spacing refinements may follow the project’s established version policy if content semantics are unchanged.

---

# 22. Template inventory — target catalogue

The implementation programme must first reconcile every currently existing Email-producing event and map it to this catalogue.

Templates listed below are target coverage, not authorization to enable non-existent product capabilities.

## 22.1 Security / identity

```text
account_email_verification
password_reset
password_changed
new_sign_in_or_security_alert          FUTURE if capability exists
email_changed                          FUTURE if capability exists
mfa_added                              FUTURE if capability exists
mfa_removed                            FUTURE if capability exists
account_recovery                       if/when supported
```

## 22.2 Leadership / onboarding

```text
ceo_welcome
buyer_getting_started
seller_getting_started
vehicle_owner_getting_started
garage_getting_started
diaspora_customer_getting_started
first_vehicle_passport_milestone
first_listing_published_milestone
first_safetrade_milestone
major_product_announcement
annual_community_letter
```

## 22.3 Conversations

```text
marketplace_new_message
dealer_new_message
garage_new_message
parts_new_message
diaspora_new_message
support_new_message
regulated_workflow_new_message         minimized content
```

## 22.4 Marketplace / transactional

```text
listing_published
listing_unpublished
listing_expiring_or_action_needed      only if real workflow exists
reservation_created
reservation_updated
inspection_booked
inspection_changed
```

## 22.5 SafeTrade / payment

```text
safetrade_started
safetrade_stage_changed
payment_initiated
payment_success
payment_failed
refund_started
refund_completed
```

Only live payment states may be implemented.

## 22.6 Vehicle Passport / Trust

```text
passport_created
passport_updated
evidence_received
evidence_verified
evidence_rejected
trust_score_changed
inspection_result_ready
trust_safety_action_required
```

## 22.7 Garage / service

```text
work_order_created
work_order_updated
booking_confirmed
service_reminder
service_completed
```

## 22.8 Parts / PartSentry

```text
parts_order_created
parts_order_updated
partsentry_alert
parts_request_response
```

## 22.9 Diaspora / logistics

```text
rfq_received
import_order_update
document_required
document_received
container_status_update
shipment_milestone
```

## 22.10 Finance / insurance

```text
finance_application_received
finance_application_update_minimal
insurance_request_received
insurance_update_minimal
```

Email body detail remains minimized for regulated information.

## 22.11 Referral

```text
referral_invitation_user_initiated
referral_joined
referral_reward_state
```

## 22.12 Marketing/editorial

```text
carup_weekly
weekly_car_highlights
new_verified_vehicles
curated_price_drops
vehicle_education
trust_education
diaspora_education
reengagement
approved_partner_campaign
```

---

# 23. Six reference templates — first visual implementation batch

Before broad migration, the team must implement and physically review six representative templates.

These six are the design-system proving ground.

## R1 — CEO Welcome

Proves:

- leadership voice;
- personalization;
- mission;
- role-based next steps;
- leadership signature;
- lifecycle footer.

## R2 — Password Reset

Proves:

- security identity;
- institutional trust;
- accessible CTA;
- anti-phishing guidance;
- security footer;
- no promotional leakage.

## R3 — Marketplace Conversation

Proves:

- vehicle media;
- human participant context;
- message excerpt;
- reply routing;
- safety notice;
- mobile vehicle card.

## R4 — SafeTrade Transaction Confirmation

Proves:

- financial/transaction structure;
- status and reference hierarchy;
- next-step list;
- regulated/sensitive restraint;
- support route.

## R5 — Vehicle Passport / Trust Update

Proves:

- trust metrics;
- evidence status;
- data-rich presentation;
- action-oriented service design.

## R6 — CarUp Weekly / Weekly Car Highlights

Proves:

- editorial visual identity;
- hero media;
- vehicle cards;
- curation;
- preference/unsubscribe footer;
- multi-module responsive design.

### Reference batch acceptance rule

All six must visibly feel like the same company while clearly serving different purposes.

If they feel like six unrelated brands, the design system has failed.

If they look identical except for copy, the design system has also failed.

---

# 24. Preview and development tooling

Implementation should include a safe local/staging preview mechanism.

Required capabilities:

- render each template with deterministic fixtures;
- view desktop and narrow/mobile widths;
- inspect HTML and text versions;
- use non-secret, non-production fixture data;
- create screenshots for owner review;
- identify template key/version in the preview UI or metadata;
- render images-disabled test fixtures where feasible.

A useful script could generate static preview HTML into a gitignored artifact directory, but the final approach should match repository tooling.

No preview route may expose real one-time auth/reply/unsubscribe tokens.

---

# 25. Testing and certification matrix

Email certification has three levels.

## 25.1 Level A — deterministic renderer tests

For every template:

- subject;
- preheader;
- required personalization fallback;
- HTML escaping;
- canonical URL enforcement;
- footer family;
- sender persona;
- classification/provider contract;
- unsubscribe requirement where marketing;
- regulated-data minimization;
- plain-text semantic parity;
- no undefined/null placeholders;
- media fallback.

## 25.2 Level B — structural/render tests

At minimum:

- desktop 600/640px rendering;
- mobile 320–390px rendering;
- images disabled;
- dark mode sanity;
- long name;
- no name;
- long vehicle model;
- missing optional media;
- long localized price/location strings;
- CTA/link wrapping;
- footer wrapping.

## 25.3 Level C — real inbox certification

Reference templates must be physically observed in real email clients.

Target matrix:

```text
Gmail web                 mandatory
Gmail mobile              mandatory
Apple Mail iOS/macOS      strongly recommended
Outlook web               mandatory before broad production rollout
Outlook desktop           target where accessible
```

Physical certification must inspect:

- sender display name;
- subject/preheader;
- logo and images;
- spacing/hierarchy;
- CTA behaviour;
- Reply-To where applicable;
- unsubscribe/preferences;
- dark mode where relevant;
- no broken assets;
- no raw template variables;
- no provider/internal URLs;
- footer/contact correctness.

---

# 26. Benchmark quality rubric

A customer-facing template should score at least **90/100** before production rollout.

| Area | Points |
|---|---:|
| Brand recognition / consistency | 15 |
| Visual hierarchy / scanability | 15 |
| Purpose clarity / relevance | 10 |
| Primary action quality | 10 |
| Trust / security / institutional credibility | 15 |
| Contact / legal / preference completeness | 10 |
| Media/context quality | 10 |
| Accessibility / mobile resilience | 10 |
| Deliverability-conscious design | 5 |
| **Total** | **100** |

Any template with a critical compliance/security defect fails regardless of score.

## 26.1 Automatic fail conditions

Examples:

- missing unsubscribe for marketing;
- broken CTA;
- invalid canonical origin;
- marketing sent from wrong provider;
- sensitive regulated data exposed;
- missing plain-text meaning;
- inaccessible essential text;
- raw debug/internal variables;
- invented legal/leadership identity;
- fake support contact;
- template enables a product capability that does not exist.

---

# 27. Implementation phases

The programme should execute in one coherent lane, but with explicit internal phases.

## X0 — Reconciliation and inventory

- current `main` and active lanes;
- current template records/versions;
- every code path that sends Email;
- every current customer-facing subject/body;
- existing logo/brand assets;
- current preference/suppression schema;
- sender identities;
- current public/legal/footer copy;
- real stakeholder roles/workflows;
- current staging rendering evidence.

Deliverable: exact inventory and gap matrix against this plan.

## X1 — Owner brand freeze

Owner decisions required before customer-facing production implementation:

- corporate descriptor;
- consumer tagline/payoff line;
- CEO/founder public display name and title;
- optional CEO signature/headshot assets;
- legal entity name;
- postal/registered address where required;
- approved social/profile links, if any;
- support/privacy/terms/security URLs.

Implementation may scaffold configurable fields before these are filled, but MUST NOT invent live values.

## X2 — Shared renderer / component system

Build:

- brand tokens;
- shared shell;
- six layouts;
- reusable components;
- name resolver;
- canonical link builder;
- media policy;
- footer system;
- text renderer;
- template registry.

Migrate current auth templates onto the shared system without weakening certified auth behaviour.

## X3 — Six reference templates

Implement R1–R6.

Owner visual review is mandatory before broad migration.

## X4 — Preference and legal presentation

- preference-management presentation;
- marketing footer;
- unsubscribe presentation;
- reason-received language;
- legal/contact mapping;
- security contact presentation.

Existing one-click suppression semantics remain authoritative.

## X5 — Full live-template migration

Map every live Email-producing event to a family/template.

Replace message-dump presentation with governed templates.

Do not enable dormant target catalogue items unless the corresponding product flow exists.

## X6 — Weekly/editorial system

- vehicle selection data contract;
- image handling;
- Trust Score/evidence display policy;
- modular editorial sections;
- saved-search/watchlist personalization;
- marketing consent/frequency policy;
- CarUp Weekly template.

## X7 — Preview + cross-client certification

Run Level A/B/C tests.

Owner physically reviews reference templates in inboxes.

## X8 — Staging rollout and observational UAT

Send bounded real staging messages through the actual providers.

Verify lifecycle, Reply-To, preferences, assets, branded links and suppression still behave exactly as Email 1.0 certified.

## X9 — Production readiness packet

Production remains inactive until separately authorized.

Return:

```text
TEMPLATE_INVENTORY=
REFERENCE_TEMPLATES=
BRAND_FREEZE=
CLIENT_CERTIFICATION=
ACCESSIBILITY=
DELIVERABILITY=
PREFERENCE_GOVERNANCE=
REGULATED_DATA_POLICY=
STAGING_RUNTIME_PARITY=
FINAL_CI=
PRODUCTION_ACTIVATION_RECOMMENDATION=
OPEN_RISKS=
```

---

# 28. Database and template-governance rules

## 28.1 Existing authority first

The implementation MUST reconcile and reuse existing:

- `communication_templates`;
- template-version records;
- notification queue;
- communication preferences;
- campaign/delivery records;
- suppressions;
- provider attempts;
- stakeholder matrix.

Do not create a second “email template” database unless live evidence proves the existing schema cannot model a required contract.

## 28.2 Design metadata

If the current template schema needs metadata extensions, prefer small explicit fields/JSON metadata for family, renderer version and brand version rather than duplicating content state.

## 28.3 Template provenance

Every delivered email should be traceable to:

```text
template key
version
classification
provider
notification / campaign intent
rendering version
```

without storing secret capability tokens in public receipts.

---

# 29. Analytics and measurement

Success is not only delivery.

The programme SHOULD define safe metrics by family.

## Security / transactional

- delivery rate;
- bounce rate;
- action completion where appropriate;
- support escalation;
- failed-link rate.

Open tracking is not the primary success criterion for security.

## Conversations

- delivered;
- reply-through-email success;
- view-conversation action;
- no duplicate canonical messages.

## Marketing/editorial

- delivery;
- complaint rate;
- unsubscribe rate;
- open/click where provider/privacy policy allows;
- vehicle/detail engagement;
- preference retention;
- content-module performance.

Analytics must not override consent/privacy policy.

---

# 30. Contact and footer mapping

The already-provisioned human aliases should be used intentionally.

```text
support@carup.dev
security@carup.dev
privacy@carup.dev
legal@carup.dev
dpo@carup.dev
info@carup.dev
press@carup.dev
```

Recommended mapping:

| Purpose | Contact |
|---|---|
| General/customer help | `support@carup.dev` |
| Suspicious account/security issue | `security@carup.dev` |
| Privacy request | `privacy@carup.dev` |
| Data protection / DPO | `dpo@carup.dev` |
| Legal/terms | `legal@carup.dev` |
| General institutional contact | `info@carup.dev` |
| Editorial/media | `press@carup.dev` |

Do not display all aliases in all emails.

---

# 31. Leadership, social and public-presence dependencies

Before production leadership/editorial rollout, the owner should freeze:

- approved CEO/founder public identity;
- whether CEO welcome carries a headshot;
- whether it carries a signature image;
- public leadership bio/profile URL if any;
- official social channels;
- public press/media destination;
- official corporate/legal descriptor.

Until then, components can exist with fixture placeholders in previews only.

Fixture placeholders MUST be visibly non-production and must never be sent to real customers.

---

# 32. Agent guardrails

Any agent implementing or refining CarUp Email MUST read this document first.

Agents MUST NOT:

- invent a new email visual language;
- copy a third-party brand/template wholesale;
- use the CEO identity in every template;
- introduce a second consent authority;
- make Brevo transactional;
- make Resend marketing by default;
- bypass suppression for “important marketing”;
- include sensitive evidence/financial data because it “looks useful”;
- use non-canonical links;
- add unapproved logos, social links, addresses, executive names or legal copy;
- ship a template only from a browser preview without inbox certification;
- regard provider `delivered` as visual/experience certification;
- change product functionality merely to make an email prettier;
- migrate to a new rendering framework without an approved amendment.

---

# 33. Definition of Done

Email Experience & Design System 1.0 is complete only when all of the following are true.

## Foundation

- [ ] Brand tokens are canonical and reusable.
- [ ] Corporate descriptor is owner-frozen.
- [ ] Consumer tagline/payoff line is owner-frozen or explicitly deferred.
- [ ] Legal entity/address requirements are resolved.
- [ ] Sender persona matrix is implemented.
- [ ] Leadership identity is owner-approved for leadership templates.

## Components

- [ ] Shared shell implemented.
- [ ] Six layout families implemented.
- [ ] Canonical buttons/cards/badges/panels implemented.
- [ ] Security/transactional/marketing footer families implemented.
- [ ] Media architecture implemented.
- [ ] Plain-text rendering is first-class.

## Reference templates

- [ ] CEO Welcome passes.
- [ ] Password Reset passes.
- [ ] Marketplace Conversation passes.
- [ ] SafeTrade Transaction passes.
- [ ] Vehicle Passport / Trust Update passes.
- [ ] CarUp Weekly / Weekly Car Highlights passes.

## Governance

- [ ] Every live Email-producing event mapped to a template family.
- [ ] No live message-dump customer templates remain unless explicitly owner-approved.
- [ ] Marketing preference/unsubscribe presentation works.
- [ ] Regulated-data rules pass.
- [ ] Sender persona/provider classification passes.
- [ ] Existing Email 1.0 transport invariants remain intact.

## Quality

- [ ] Gmail web physical rendering pass.
- [ ] Gmail mobile pass.
- [ ] Outlook web pass.
- [ ] Apple Mail target pass where accessible.
- [ ] Mobile responsiveness pass.
- [ ] Images-disabled pass.
- [ ] Dark-mode sanity pass.
- [ ] Accessibility pass.
- [ ] Benchmark score >= 90/100 for reference templates.
- [ ] No critical automatic-fail condition.

## Operational

- [ ] Canonical CI green.
- [ ] Communications CI covers design-system tests.
- [ ] staging API/runtime revision parity proven.
- [ ] real provider sends certified in staging.
- [ ] suppression/unsubscribe still physically certified.
- [ ] canonical inbound conversation Reply-To still physically certified.
- [ ] production remains separately owner-gated.

---

# 34. Owner approval gates

The following are deliberate owner decisions and MUST NOT be guessed by an agent.

## Gate B1 — Brand identity freeze

Owner provides/approves:

```text
CORPORATE_DESCRIPTOR=
CONSUMER_TAGLINE=
```

## Gate B2 — Leadership identity

Owner provides/approves:

```text
CEO_DISPLAY_NAME=
CEO_PUBLIC_TITLE=
CEO_HEADSHOT_APPROVED=YES/NO
CEO_SIGNATURE_ASSET_APPROVED=YES/NO
LEADERSHIP_REPLY_TO=
```

## Gate B3 — Legal/public footer identity

Owner provides/approves:

```text
LEGAL_ENTITY_NAME=
REGISTERED_OR_POSTAL_ADDRESS=
PRIVACY_URL=
TERMS_URL=
SUPPORT_URL=
APPROVED_SOCIAL_URLS=
```

## Gate B4 — Reference-template visual approval

Owner reviews the six real rendered reference emails and approves the visual system before broad migration.

## Gate B5 — Production rollout

Separate from implementation merge. Production Communications remains an owner-controlled activation programme.

---

# 35. Immediate next step after this plan is approved

Once the owner approves/canonizes this plan, the implementation agent should receive one bounded directive:

1. reconcile live main and current Email 1.0 state;
2. perform X0 inventory;
3. stop only for the B1/B2/B3 owner identity data that cannot be inferred;
4. build the shared renderer/components;
5. implement six reference templates;
6. return real visual previews for owner review;
7. only after B4 proceed to broad template migration and Weekly Car Highlights;
8. certify physically through current Resend/Brevo staging providers;
9. stop at production activation recommendation.

No implementation should begin merely because this draft exists. Owner approval of this canonical plan is the implementation authorization boundary.

---

# 36. Canonical product statement

The desired end state is:

> **CarUp Email should feel like CarUp itself — trusted, premium, intelligent, automotive, human and action-oriented. Security messages should make people feel protected. Transactions should make people feel informed. Conversations should feel human. Vehicle intelligence should make CarUp’s trust network tangible. Marketing should be worth opening. Leadership messages should make clear that real people with a real mission stand behind the platform.**

This is the standard against which future refinements must be judged.

---

# 37. Plan-change governance

After owner approval, this document becomes the canonical reference for CarUp customer Email presentation.

Material changes require one of:

- an explicit owner-approved amendment in this document;
- a superseding canonical Email Experience plan clearly linked from this document.

Agents may refine implementation details, but may not silently redefine the product goal.

Historical implementation receipts should point back to this plan so future teams can distinguish:

```text
CANONICAL INTENT      this document
IMPLEMENTATION        source/templates/components
CERTIFICATION         physical receipts / CI / provider evidence
FUTURE REFINEMENT     amendments or later versions
```

That separation is intentional. It prevents short-term implementation convenience from gradually degrading the customer experience standard.
