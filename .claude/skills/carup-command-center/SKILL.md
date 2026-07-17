---
name: CarUp Command Center
summary: Execute the complete CarUp Enterprise Communication Command Center plan through implementation, verification, staging activation, review, and PR readiness.
description: Use for Issue #107 and Agent 8 work on the CarUp enterprise omnichannel Communication Command Center. Reads the authoritative repo plan and continues every phase without phase-by-phase pauses until the measurable staging goal is achieved or a genuine external blocker is proven.
argument-hint: "[start|continue|audit|verify]"
---

# CarUp Enterprise Communication Command Center Skill

## Live repository context

- Current branch: !`git branch --show-current`
- Current head: !`git log -1 --oneline`
- Working tree: !`git status --short`
- Worktrees: !`git worktree list`

## Authoritative contract

Read this file completely before planning or editing:

`docs/agent-8-omnichannel/ENTERPRISE_COMMUNICATION_COMMAND_CENTER_GOAL_LOOP.md`

Also inspect GitHub Issue #107, PR #111, the current Agent 8 branch topology, recent review comments, and active concurrent work.

## Directive

Execute the authoritative plan as one continuous workflow. Do not stop after discovery, design, one UI pass, tests, deployment, or review. Continue through every phase until the exact `/goal` condition in the plan is evidenced.

Treat `$ARGUMENTS` as the requested operating mode:

- `start`: begin from repository/branch safety and run every phase.
- `continue`: inspect completed evidence, CI, deployments, review feedback, and remaining checklist items, then continue from the first incomplete gate.
- `audit`: run the full requirement, security, accessibility, performance, schema, and operations gap audit, then fix all actionable findings.
- `verify`: run automated and live staging verification, fix failures, update evidence, and continue until PR readiness.

## Execution rules

1. Protect unrelated WIP. If the current directory has unrelated changes, create or use an isolated worktree from the latest correct Agent 8/PR #111 head.
2. Do not overwrite another agent's files, pop unknown stashes, or mix unrelated branches.
3. Use parallel/subagents for discovery, UX, backend/data contracts, accessibility, security, performance, tests, and adversarial review when work is independent.
4. Keep one lead agent responsible for integration, evidence, and the completion checklist.
5. Preserve real Telegram and WhatsApp behavior. Never accept fake provider output as success.
6. Prefer additive, backward-compatible backend/schema changes.
7. Use real migration schemas in tests; do not rely only on permissive in-memory repositories.
8. Use `/run` and `/verify` against the running app, plus `/code-review` before PR readiness.
9. Deploy and validate against staging Supabase and staging provider configuration only.
10. Do not merge to main or alter production database, secrets, or webhooks without explicit user approval.

## Required evidence each iteration

Surface concrete evidence in the transcript so `/goal` can evaluate completion:

- files changed and why;
- tests/commands with exit codes;
- route/API/schema changes;
- screenshots or running-app verification;
- staging deployment URLs and health;
- live Telegram/WhatsApp provider evidence;
- review findings and resolutions;
- remaining checklist items or exact external blocker.

## Loop behavior

When invoked by `/loop`, do not restart completed phases. Inspect current branch, PR, CI, deployments, plan checklist, and evidence; continue the highest-priority incomplete item. Address failed checks and review comments. If everything is green, perform simplification, security, accessibility, performance, and operational-clarity passes before claiming completion.

## Stop rule

Do not ask for phase approval. Stop only when the plan's exact goal is achieved, or when a genuine external account/credential/approval blocker prevents further safe work. In that case, finish all unblocked tasks, show evidence, and provide one deterministic operator action required to resume.
