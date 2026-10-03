# One CarUp — Moderator Operating Context

**Status:** canonical and mandatory. Programme: One CarUp, the project reconciliation and product convergence of `kudzimusar/carup`.
**Applies to:** the programme moderator, the MPM (One CarUp Master Plan Moderator / Programme Controller), and every specialist implementation agent.

This file is the single canonical moderator context. If another One CarUp moderator context appears, update this file rather than creating a parallel one.

## 1. Standing rule: no acceptance from prose

> **No implementation-agent report is accepted from prose alone.**
>
> The moderator must independently inspect the exact code, diff, tests, migrations, runtime evidence and exact pushed SHA before ACCEPT / REMEDIATE / BLOCK.
>
> **Implementation agents do not self-accept.**
>
> Every code change submitted for moderator review must be committed and pushed to a named remote branch before the report is issued.
>
> The report must identify:
>
> **repository → branch → base SHA → exact pushed head SHA → changed files → tests → runtime evidence.**
>
> Local-only code is not moderator-reviewable. If work cannot be pushed, it must be explicitly classified **LOCAL-ONLY / NOT REVIEWED** and supplied as an evidence patch or archive.

## 2. The moderator loop

```
inspect code → verify claim → identify first proven defect
            → patch if bounded OR task specialist
            → verify exact pushed head
            → ACCEPT / REMEDIATE / BLOCK
            → release next task
```

Never task the next implementation phase from an agent's conclusions until the underlying code has been inspected.

## 3. Push and custody policy

Every MPM or specialist implementation report must include, captured immediately before handoff:

```
git status --short --branch
git rev-parse HEAD
git rev-parse origin/<working-branch>
```

- **Reviewability requires `HEAD == origin/<working-branch>`, and the report must prove it.**
- **Unrelated changes stay out of the task commit.** If the worktree contains unrelated changes, do not include them.
- **No history rewriting.** Do not force-push or rewrite previously reviewed SHAs.
- **Unpushed code is not complete.** If an agent modifies code and does not push it, the MPM reports **IMPLEMENTATION NOT REVIEWABLE — LOCAL ONLY** and must not call the work complete.

## 4. Keep the four SHAs apart

Never treat these as interchangeable. Record each one separately.

| SHA | What it is |
|---|---|
| implementation SHA | the pushed head that contains the code |
| documentation SHA | a docs/receipt commit, which may be later than the implementation |
| deployment SHA | what a deployment actually serves, proven from its runtime provenance (for example `GET /api/health` → `build.commit_sha`), never inferred from a merge |
| certification SHA | the exact head a CI run or UAT certified |

Merging to `main` does not promote CarUp production.

## 5. Evidence hygiene

Lessons from OC-0/OC-1:

- **Ahead/behind counts come from full history.** A shallow clone produces false counts (the phantom "2,049 ahead"). Confirm `git rev-parse --is-shallow-repository` is `false`, or use the GitHub compare API. `scripts/lint-baseline-gate.mjs` runs `git fetch --depth 1` and re-shallows a full clone, so re-check after running it.
- **A path-filtered or lane-only CI gate is not canonical CI.** `ci.yml` runs only on pull requests to, and pushes to, `main`. State which gates actually ran on the exact head.
- **Verify a claimed guard fails first.** Re-introduce the defect and prove that the guard catches it.
- **Production state is runtime evidence.** Read-only provenance reads are allowed. Production mutation (deploys, firewall rules, model or provider changes) requires an explicit containment or release task from the programme moderator.
