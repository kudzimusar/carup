# R3 Evidence ZIP — Verification Manifest (branch: evidence/r3-download)

**Artifact:** `CARUP-UX-REBUILD-01_RX02A_S1_4B_LR01_R3_EVIDENCE.zip`
**Size:** 10,326,328 bytes
**SHA-256:** `28ce07423c6604f7d42669c238340932861fe16519667ce2970aef241c1cb735`

This branch carries the integrity manifest for the R3 evidence ZIP so any
copy the reviewer obtains can be byte-verified against the canonical hash.

## Verify

```sh
sha256sum CARUP-UX-REBUILD-01_RX02A_S1_4B_LR01_R3_EVIDENCE.zip
# must equal 28ce07423c6604f7d42669c238340932861fe16519667ce2970aef241c1cb735
```

## Provenance

- Produced 2026-11-14 from targeted Chromium captures against the isolated QA
  fixture backend (engineering evidence, not live business UAT).
- `SHA256SUMS.txt` — per-file checksums inside the archive.
- `FILELIST.txt` — per-file byte sizes.
- `report.json` excerpt is embedded in PR #269 (comment 6868064617).

## Download channel note

The canonical ZIP is delivered with the R4 return bundle to the Owner
(byte-identical, hash above). The engineer's GitHub write path (repository
MCP, inline file content) cannot carry a 10.3 MB binary payload, so the ZIP
itself is attached to the review thread by the Owner (GitHub comment
attachments accept ZIP up to 25 MB) rather than committed to this branch.
This branch exists so the attachment can be hash-verified on receipt.
