# 02 — Codes, Coupons, QR, Barcode, and Attribution TRD

## Purpose

Create one traceable identity layer for all referral and campaign activity.

## Code types

- Member referral code: stable identity for a user.
- Campaign code: linked to a route, product category, or local promotion.
- Coupon code: discount or benefit code used at checkout or booking.
- Group code: code assigned to a WhatsApp group, church group, community, garage, or diaspora chapter.
- Agent code: code assigned to an approved operator or partner location.

## Required outputs per code

Each code must generate:

- Short referral URL.
- QR code.
- Barcode.
- WhatsApp prefilled share link.
- Telegram bot start link.
- Facebook/Instagram campaign URL.
- Printable poster text.
- UTM-style campaign parameters.

## Attribution rules

The system must store first-touch, last-touch, and assisted-touch events. A commercial milestone may involve multiple helpers, so the rules must support primary referrer, secondary campaign, and channel source.

## AI use

The Attribution Agent validates whether a code is active, expired, campaign-bound, location-bound, or role-bound. It explains to the user what the code provides and records the decision in the event log.

## Acceptance criteria

- Invalid codes fail safely.
- Expired codes explain expiry.
- Valid codes attach to the session and user profile.
- QR and barcode scans create referral events.
- Attribution survives login, quote, booking, and checkout steps.
