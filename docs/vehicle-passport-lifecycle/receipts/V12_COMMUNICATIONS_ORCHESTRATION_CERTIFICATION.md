# V12 — Communications Lifecycle Orchestration

**Date:** 2026-08-28
**Phase:** V12 — Communications Lifecycle Orchestration
**Status:** FOUNDATION PASS / END-TO-END DELIVERY BLOCKED BY PR #183

## Scope

V12 defines the boundary between Vehicle Passport lifecycle events and Communications 2.0.

Passport may identify a lifecycle communication need and build a safe canonical domain-event intent.

Passport does not select:

- provider;
- channel;
- governed template;
- fallback sequence;
- delivery worker;
- external address.

Those remain Communications responsibilities.

## Files added

- `backend/services/passport/passportCommunicationIntent.js`
- `backend/tests/passport-v12-communications.test.js`

## Lifecycle classes

- evidence review;
- discrepancy;
- Trust material change;
- service/maintenance;
- compliance due;
- ownership transfer;
- Marketplace transaction;
- safety/recall.

## Event identity

An intent requires either:

- persisted canonical `domain_event_id`; or
- a deterministic dedupe key.

This prevents a lifecycle action from becoming an untraceable notification burst.

## Recipient model

Passport supplies a CarUp account reference such as `recipientUserId`.

It does not supply a transport address.

## Transport fail-closed rule

Transport keys such as channel/provider/email/phone/WhatsApp/Telegram/template are rejected from the Passport safe payload.

## Canonical integration

Live reconciliation of Communications PR #183 confirms that Communications already owns:

`domain_events → policy → thread/notification → channel routing → provider/fallback`

and its event listener passes the raw outbox event identity through for durable dedupe.

Passport therefore stops at the domain-event intent boundary.

## Runtime blocker

PR #183 remains an active Draft runtime lane. Seller S10 is also externally blocked on it.

No speculative WhatsApp/email staging send is performed from Passport Foundation.

## Exact-head certification

Certified code head:

- exact code head: `db79900250015565b88642367da18fd00c5d68b2`
- Vehicle Passport Foundation CI run: `33165643885` — **PASS**
- Passport V1–V12 cumulative contracts — PASS
- canonical communication event coverage — PASS
- canonical Trust/source/governance/evidence/lookup/service/PartSentry guards — PASS
- syntax/diff hygiene — PASS

The provider anti-fork test was proactively narrowed before certification so that the safety deny-list words `whatsapp`/`telegram` are not mistaken for provider integration. The runtime module still imports no Communications provider or delivery implementation.

## Phase decision

**V12 FOUNDATION PASS. END-TO-END COMMUNICATION DELIVERY REMAINS BLOCKED UNTIL #183 RECONCILIATION AND SELLER S10 CERTIFICATION.**
