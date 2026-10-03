# OC-P0 Production Verification Containment Receipt

## Scope

One CarUp production containment for legacy verification routes, recorded after
the Vercel firewall rule was published. This receipt contains no application
code, database, DNS, environment-variable, alias, or deployment-SHA changes.

## Production identity before firewall mutation

- Project: `carup-backend`
- Production endpoint: `https://api.carup.dev/api/health`
- Response status: `200` (`UP`)
- Production SHA: `78303ed60e639c6ed7b6afa318abaf8f0b43e977`
- Deployment ID: `dpl_HDk3bgvirCXVvu7ouTwSg8hyje3U`
- Environment: `production`

## Firewall containment

- Rule name: `OC-P0C contain legacy verification routes`
- Rule ID: `rule_oc_p0_c_contain_legacy_verification_routes_ccZ2AS`
- Status: live and valid in the `carup-backend` project firewall
- Action: `deny`
- Conditions: OR of the following literal or prefix path conditions:
  - path equals `/api/verification/ocr`
  - path starts with `/api/verification/ocr/`
  - path equals `/api/verification/fraud-scan`
  - path equals `/api/verification/fraud-scan/`
  - path equals `/api/verification/trust-score`
  - path starts with `/api/verification/trust-score/`
  - path equals `/api/verification/promote-trust`
  - path starts with `/api/verification/promote-trust/`

No regular expression condition is used.

## Explicit non-target paths

The rule has no condition matching these paths:

- `/api/verification/trust-facts/*`
- `/api/verification/review-queue`
- `/api/verification/audit-trail/*`
- `/api/verification/partsentry/*`
- `/api/ai/ocr`

## Before and after evidence

Before publication, Vercel reported no custom firewall rules for
`carup-backend`. After publication, the rule above was returned as active,
valid, live, with no draft changes remaining.

Harmless production GET checks after publication:

| Path | Result | Evidence |
|---|---:|---|
| `/api/verification/ocr` | 403 | Vercel response with `x-vercel-mitigated: deny` |
| `/api/verification/ocr/nonexistent/approve` | 403 | Vercel response with `x-vercel-mitigated: deny` |
| `/api/verification/fraud-scan` | 403 | Vercel response with `x-vercel-mitigated: deny` |
| `/api/verification/trust-score/nonexistent` | 403 | Vercel response with `x-vercel-mitigated: deny` |
| `/api/verification/promote-trust` | 403 | Vercel response with `x-vercel-mitigated: deny` |
| `/api/verification/review-queue` | 401 | Application JSON: `Unauthorized. No active user context.` |

No legacy verification endpoint was POSTed.

## Rollback

1. In the Vercel dashboard, open the `carup-backend` project firewall rules.
2. Disable or remove rule ID `rule_oc_p0_c_contain_legacy_verification_routes_ccZ2AS`.
3. Publish the firewall configuration.
4. Re-run the harmless GET checks and confirm the expected application behavior.

The rollback changes only the firewall rule; it does not redeploy the
application or change the production alias.

## Vercel cost-control state

- Team on-demand budget: `$1`, active.
- Alerts: enabled at `50%`, `75%`, and `100%`.
- Automatic pause: disabled for the current billing cycle because spend has
  already exceeded the budget.
- Active CarUp projects: Git-triggered deployments disabled and build machines
  set to Basic/Fixed.

## Review status

This is an evidence receipt for programme moderator review. It is not a
self-acceptance or production certification statement.
