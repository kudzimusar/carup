# CarUp Milestone Execution Protocol

This document defines how implementation agents — including Claude Code, Codex, Kimi Code, OpenCode, and any future execution agents — must plan, execute, verify, document, and report CarUp work.

The protocol preserves thorough technical direction while reducing repeated micro-approval delays.

---

## 1. Core Execution Principle

- Instructions must remain **detailed, explicit, and testable**. Development speed must never come from vague prompts or reduced verification.
- The **Product Owner approves complete milestones** rather than every expected sub-step.
- Once a milestone is approved, the assigned agent should **execute it end-to-end** within the approved scope.
- Agents must **stop only when a mandatory stop condition occurs** (see §5).

### Normal Lifecycle

```
Plan → Approve milestone → Execute → Test → Verify → Document → Open PR → Review → Merge approval
```

---

## 2. Project Roles

### Product Owner

Responsible for:

- Business intent
- Milestone approval
- Production-write authorization
- Production deployment approval
- Final merge approval

### Technical Director

Responsible for:

- Translating business intent into technical milestones
- Setting scope and guardrails
- Defining success criteria
- Reviewing risks and dependencies
- Determining whether a feature is complete

### Execution Agent

Examples: Claude Code, Codex, Kimi Code, OpenCode.

Responsible for:

- Repository inspection
- Implementation
- Testing
- Documentation
- Branch management
- Commit creation
- PR creation
- Verification reporting

---

## 3. Mandatory Planning Phase

Before implementation, the agent must inspect:

- Current branch and working tree
- Open pull requests
- Relevant application code
- Relevant tests
- Existing documentation
- Migrations and schema dependencies
- Environment-specific behavior
- Active work from other agents
- Possible overlap or conflict

The plan must identify:

| Element | Description |
|---------|-------------|
| **Objective** | What the milestone achieves |
| **Scope** | Exact boundaries of the work |
| **Files likely to change** | Anticipated file modifications |
| **Dependencies** | Prerequisites and downstream effects |
| **Risks** | What could go wrong |
| **Success criteria** | How completion is measured |
| **Test strategy** | How correctness is verified |
| **Rollback strategy** | How to reverse changes safely |
| **Explicit non-goals** | What is deliberately excluded |

The agent must **stop for milestone approval** before making material changes unless the task has already been explicitly approved.

---

## 4. Approved Execution Phase

After milestone approval, the agent may complete the approved work **without requesting permission after every expected sub-step**.

### Permitted Actions

The agent may:

- Create a branch
- Edit approved files
- Add tests
- Run tests
- Run builds
- Update documentation
- Push commits
- Open a PR
- Deploy to staging when explicitly included in scope
- Perform staging verification when explicitly included in scope

### Prohibited Actions

The agent must not:

- Broaden the scope
- Merge without approval
- Write production data without authorization
- Expose credentials or secrets
- Overwrite unrelated work
- Delete unrelated branches, data, or files
- Weaken security controls to make tests pass

---

## 5. Mandatory Stop Conditions

The agent must **stop immediately** when any of the following occurs:

### Unexpected Data Impact

More rows, records, accounts, files, or services would be changed than authorized.

### Security Risk

A credential, session, token, PII field, authorization boundary, or production secret may be exposed or weakened.

### Scope Expansion

The required fix exceeds the approved milestone.

### Verification Failure

A required test, build, deployment, or success criterion fails.

### Conflicting Work

Another branch, PR, or uncommitted change affects the same area and cannot be safely reconciled.

### Destructive Action

Deletion, irreversible migration, hard reset, production data removal, or destructive infrastructure change is required but was not explicitly approved.

### Production Mismatch

Production behavior or data differs from the approved assumptions.

### Stop Report

When stopping, the agent must report:

- The exact blocker
- Evidence
- Affected scope
- Safest available options
- Recommended next action

---

## 6. Git and Pull-Request Workflow

The required default workflow is:

1. Create a focused branch.
2. Modify only intended files.
3. Run relevant tests.
4. Review the final diff.
5. Commit with a descriptive message.
6. Push the branch.
7. Open a PR.
8. Include tests, build results, risks, and deployment evidence.
9. **Stop before merge.**

Agents must not routinely ask the Product Owner to perform staging, commits, pushes, or PR creation manually when automation is available.

---

## 7. Documentation Requirement

Every completed feature or major milestone must create or update a permanent Markdown document under:

```
docs/features/
```

The document must explain:

- Purpose
- Business objective
- User problem
- Feature boundaries
- Frontend architecture
- Backend architecture
- Database dependencies
- API contracts
- Security and privacy rules
- Configuration and environment variables
- User flows
- Tests
- Deployment behavior
- Rollback procedure
- Known limitations
- Deferred work
- Definition of done
- Implementation history or related PRs

**Documentation is part of the feature, not an optional follow-up.**

---

## 8. Environment Policy

### Local

For implementation and developer testing.

### Staging

For controlled test accounts, temporary fixtures, integration validation, migrations, and end-to-end rehearsal.

### Production

For the real customer-facing system and explicitly approved production QA.

### Rules

- Artificial test data should normally remain in staging.
- Controlled temporary production QA is allowed **only** with explicit milestone authorization, exact record scope, verification criteria, and cleanup or rollback procedures.
- Production QA data must not be confused with permanent marketplace inventory.
- Production environment variables must be verified independently from staging variables.

---

## 9. Production-Write Policy

Production writes require an approved milestone specifying:

| Requirement | Description |
|-------------|-------------|
| **Exact records or row limits** | How many records are affected |
| **Exact operation** | What write operation is performed |
| **Expected before-state** | Current state before the write |
| **Expected after-state** | Intended state after the write |
| **Rollback method** | How to reverse the operation |
| **Verification queries** | How to confirm correctness |
| **Mandatory stop conditions** | When to abort |

When the full controlled QA cycle is authorized, the agent should execute:

```
Create temporary records → verify → exercise feature → clean up or archive → verify restoration
```

without requesting approval between every expected action.

The agent must still **stop if a guardrail fails**.

---

## 10. Definition of Done

A milestone is complete only when **all applicable** criteria are satisfied:

- [ ] Implementation complete
- [ ] Tests pass
- [ ] Build passes
- [ ] Staging behavior verified
- [ ] Production behavior verified (when required)
- [ ] Security boundaries preserved
- [ ] Documentation updated
- [ ] Rollback documented
- [ ] PR opened
- [ ] Final status reported
- [ ] Product Owner approves merge or closure

---

## 11. Reporting Format

Every milestone completion report must include:

| Field | Required |
|-------|----------|
| Milestone name | ✅ |
| Branch | ✅ |
| Commit SHA | ✅ |
| PR number and link | ✅ |
| Files changed | ✅ |
| Tests executed | ✅ |
| Build results | ✅ |
| Staging result | ✅ |
| Production result (when applicable) | ✅ |
| Risks or known limitations | ✅ |
| Rollback procedure | ✅ |
| Work explicitly not performed | ✅ |
| Recommended next milestone | ✅ |
