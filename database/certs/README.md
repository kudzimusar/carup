# Supabase trust anchor

`supabase-prod-ca-2021.crt` is the **public** root certificate Supabase's Postgres endpoints chain
to — `CN=Supabase Root 2021 CA`, self-signed, valid 2021-04-28 → 2031-04-26,
SHA-256 fingerprint `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

It is a certificate, not a key and not a secret. Publishing it is the point: it is how a client
proves it is talking to Supabase rather than to something in the middle.

## Why it is here

The Supabase root is self-signed and is **not** in Node's bundled public root store, so a connection
made with `rejectUnauthorized: true` and default roots fails with
`self-signed certificate in certificate chain`. Historically the repository worked around that with
`ssl: { rejectUnauthorized: false }` (see the ledger #19/#20 appliers), which does not fix the
problem — it stops checking, and a connection that does not verify can be intercepted by anything
positioned in front of it.

Bundling the root instead means verification genuinely succeeds against a **pinned** trust anchor,
which is stronger than either alternative: stronger than not verifying, and stronger than trusting
every public CA on the internet.

## Precedence

`backend/scripts/diaspora-staging-apply-gtm.mjs` resolves its trust anchor in this order:

1. `DIASPORA_STAGING_CA_CERT` — an explicitly supplied PEM, so an operator can override without a
   code change (for example after a root rotation).
2. This bundled root.
3. Node's bundled public roots.

Verification is never disabled by any of those paths. `DIASPORA_STAGING_TLS_INSECURE=true` remains
the single, loudly-warned escape hatch, and exists only to diagnose a chain problem.

## Rotation

When Supabase rotates its root, add the new PEM here and list it alongside this one — `ssl.ca`
accepts an array, so both roots can be trusted across the overlap window without a flag day.
