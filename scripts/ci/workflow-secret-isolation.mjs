#!/usr/bin/env node
/**
 * CARUP-PAY-05-LR01 Checkpoint A — workflow secret-isolation policy and pull-request dry run.
 *
 * WHY
 * Opening a same-repository pull request ran `diaspora-phases-3-7-validation`'s staging-integration job with
 * `secrets.DIASPORA_STAGING_DATABASE_URL`, and that job writes (then deletes) rows on SHARED staging. 54 of 54
 * Payments pull-request runs did so (2026-10-29 … 2026-11-02). Eleven more pull-request workflows held staging
 * credentials behind per-PR pins, labels or in-script refusals. An expression pin is not a boundary: the next
 * workflow edit removes it. This policy is structural instead.
 *
 * THE POLICY (each rule has a code the tests and the CI report use)
 *   WSI-PRIVILEGED-PR-EVENT   No workflow is triggered by pull_request_target or workflow_run: both run with the base
 *                             repository's secrets and write token on behalf of pull-request activity.
 *   WSI-PR-SECRET             A workflow that a pull-request event can start (pull_request, pull_request_review,
 *                             pull_request_review_comment, issue_comment, merge_group) references no secret except
 *                             GITHUB_TOKEN, never inherits or dynamically reads secrets, names no environment, calls no
 *                             local reusable workflow that does any of that, and calls no remote reusable workflow.
 *   WSI-SHARED-DATA-REACH     A job holding a shared-data credential (a database URL, a service-role key, a staging or
 *                             production credential, a worker/scheduler secret) cannot be started by push or by any
 *                             pull-request event: only workflow_dispatch or schedule (default branch only), directly or
 *                             through workflow_call, or a top-level `github.event_name == 'workflow_dispatch'` guard.
 *   WSI-SHARED-DATA-APPROVAL  Such a job, when dispatchable, names the required-reviewer environment of its class:
 *                             staging credentials → `staging`, production credentials → `production`.
 *
 * THE DRY RUN
 *   prEventReach   — every job ANY pull-request event could start, ignoring branch/path/type filters and `if:`
 *                    (a superset), with what each could read. The CI gate requires all of them to read nothing.
 *   pushReach      — every job a push of a given branch can start (branch filters honoured, path filters ignored
 *                    as a superset), with the shared-data credentials it could read.
 *
 * Nothing here contacts GitHub, a database or any deployed environment: it reads workflow files.
 *
 * CLI: node scripts/ci/workflow-secret-isolation.mjs [--workflows DIR] [--push-branch NAME]... [--report FILE]
 *      exits 1 on any violation, any secret a pull-request job could read, or any shared-data credential a listed
 *      branch push could reach.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const RULES = Object.freeze({
  PRIVILEGED: 'WSI-PRIVILEGED-PR-EVENT',
  PR_SECRET: 'WSI-PR-SECRET',
  SHARED_REACH: 'WSI-SHARED-DATA-REACH',
  SHARED_APPROVAL: 'WSI-SHARED-DATA-APPROVAL',
});

export const PR_CONTEXT_EVENTS = Object.freeze([
  'pull_request', 'pull_request_review', 'pull_request_review_comment', 'issue_comment', 'merge_group',
]);
export const PRIVILEGED_EVENTS = Object.freeze(['pull_request_target', 'workflow_run']);
/** Events a shared-data job may be reached by: an explicit write-access dispatch, or the default branch's schedule. */
const SHARED_DATA_EVENTS = new Set(['workflow_dispatch', 'schedule']);

/** Credentials that read or write a shared database or a shared deployed environment. */
export const SHARED_DATA_SECRET = /(DATABASE_URL|DB_URL|SERVICE_ROLE|CA_CERT|UAT_PASSWORD|WORKER_SECRET|SCHEDULER_SECRET|DATA_API_METADATA_KEY|^STAGING_|_STAGING_|^PRODUCTION_)/;
/** The required-reviewer environment each credential class must sit behind. First match wins. */
const CREDENTIAL_CLASSES = Object.freeze([
  { pattern: /PRODUCTION/, environment: 'production' },
  { pattern: /STAGING|^COMMUNICATION_WORKER_SECRET$/, environment: 'staging' },
]);
const ALLOWED_PR_SECRETS = new Set(['GITHUB_TOKEN']);

// ── Parsing ───────────────────────────────────────────────────────────────────────────────────────────────

function normalizeTriggers(on) {
  if (on == null) return {};
  if (typeof on === 'string') return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map((event) => [event, {}]));
  return Object.fromEntries(Object.entries(on).map(([event, config]) => [event, config ?? {}]));
}

/** Every `${{ … }}` expression in a value, plus every `if:` (which GitHub evaluates with or without the wrapper). */
function expressionsOf(value, out = []) {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) out.push(m[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) expressionsOf(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'if' && typeof item === 'string' && !item.includes('${{')) out.push(item);
      expressionsOf(item, out);
    }
  }
  return out;
}

function secretAccess(value) {
  const secrets = new Set();
  let dynamic = false;
  for (const expression of expressionsOf(value)) {
    for (const m of expression.matchAll(/\bsecrets\b(?:\s*\.\s*([A-Za-z_][A-Za-z0-9_]*))?/g)) {
      if (m[1]) secrets.add(m[1]);
      else dynamic = true; // secrets[…], toJSON(secrets), or the whole context passed along
    }
  }
  return { secrets: [...secrets].sort(), dynamic };
}

export function parseWorkflow(file, source) {
  const doc = yaml.load(source) ?? {};
  const triggers = normalizeTriggers(doc.on ?? doc[true]);
  const workflowLevel = secretAccess({ env: doc.env ?? null, defaults: doc.defaults ?? null });
  const jobs = Object.entries(doc.jobs ?? {}).map(([id, job]) => {
    const body = job ?? {};
    const access = secretAccess(body);
    const environment = typeof body.environment === 'string' ? body.environment : body.environment?.name ?? null;
    return {
      id,
      if: typeof body.if === 'string' ? body.if : body.if == null ? null : String(body.if),
      environment,
      uses: typeof body.uses === 'string' ? body.uses : null,
      inherits: body.secrets === 'inherit',
      secrets: [...new Set([...access.secrets, ...workflowLevel.secrets])].sort(),
      dynamic: access.dynamic || workflowLevel.dynamic,
    };
  });
  return { file, triggers, workflowSecrets: workflowLevel.secrets, workflowDynamic: workflowLevel.dynamic, jobs };
}

export function loadWorkflows(dir) {
  const workflows = new Map();
  const relDir = path.relative(path.resolve(dir, '../..'), dir).split(path.sep).join('/');
  for (const name of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    const file = `${relDir}/${name}`;
    workflows.set(file, parseWorkflow(file, readFileSync(path.join(dir, name), 'utf8')));
  }
  return workflows;
}

// ── Expressions and filter patterns ───────────────────────────────────────────────────────────────────────

function stripOuterParens(text) {
  let body = text.trim();
  for (;;) {
    if (!body.startsWith('(') || !body.endsWith(')')) return body;
    let depth = 0;
    let inQuote = false;
    let closesAtEnd = true;
    for (let i = 0; i < body.length; i += 1) {
      const c = body[i];
      if (c === "'") inQuote = !inQuote;
      if (inQuote) continue;
      if (c === '(') depth += 1;
      if (c === ')') {
        depth -= 1;
        if (depth === 0 && i !== body.length - 1) { closesAtEnd = false; break; }
      }
    }
    if (!closesAtEnd) return body;
    body = body.slice(1, -1).trim();
  }
}

/** Top-level `&&` conjuncts, or null when a top-level `||` makes the expression something other than a conjunction. */
function topLevelConjuncts(text) {
  const parts = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'") { inQuote = !inQuote; continue; }
    if (inQuote) continue;
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (depth === 0 && text.startsWith('||', i)) return null;
    else if (depth === 0 && text.startsWith('&&', i)) { parts.push(text.slice(start, i)); start = i + 2; i += 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim());
}

const DISPATCH_EQUALITY = [
  /^github\.event_name\s*==\s*'workflow_dispatch'$/,
  /^'workflow_dispatch'\s*==\s*github\.event_name$/,
];

/** True only when the job condition cannot be true for any event but workflow_dispatch. */
export function dispatchOnlyGuard(expression) {
  if (typeof expression !== 'string') return false;
  let body = expression.trim();
  const wrapped = body.match(/^\$\{\{([\s\S]*)\}\}$/);
  if (wrapped) body = wrapped[1];
  const conjuncts = topLevelConjuncts(stripOuterParens(body.replace(/\s+/g, ' ')));
  if (!conjuncts) return false;
  return conjuncts.some((c) => DISPATCH_EQUALITY.some((re) => re.test(stripOuterParens(c))));
}

/** GitHub's filter-pattern syntax: `*` stops at `/`, `**` crosses it, `?`/`+` quantify the previous character. */
export function githubPatternToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i += 1; } else re += '[^/]*';
    } else if ((c === '?' || c === '+') && re.length) {
      re += c;
    } else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else { re += `[${pattern.slice(i + 1, end).replace(/[\\\]]/g, '\\$&')}]`; i = end; }
    } else if (c === '\\' && i + 1 < pattern.length) {
      re += pattern[i + 1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      i += 1;
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** An include/exclude list in GitHub order: later patterns override earlier ones, `!` excludes. */
export function matchesFilters(patterns, value) {
  let matched = false;
  for (const pattern of patterns ?? []) {
    if (pattern.startsWith('!')) { if (githubPatternToRegExp(pattern.slice(1)).test(value)) matched = false; }
    else if (githubPatternToRegExp(pattern).test(value)) matched = true;
  }
  return matched;
}

// ── Reachability ──────────────────────────────────────────────────────────────────────────────────────────

const localCallee = (uses) => (uses && uses.startsWith('./') ? uses.slice(2).split('@')[0] : null);
const isRemoteCall = (uses) => Boolean(uses) && !uses.startsWith('./') && uses.includes('/.github/workflows/');

/** What a job could read if a pull-request event started it: its own access plus anything a called workflow holds. */
function exposureOf(workflows, workflow, job, seen = new Set()) {
  const problems = [];
  const secrets = job.secrets.filter((s) => !ALLOWED_PR_SECRETS.has(s));
  if (secrets.length) problems.push(`reads ${secrets.join(', ')}`);
  if (job.dynamic) problems.push('reads secrets dynamically');
  if (job.inherits) problems.push('inherits every secret');
  if (job.environment) problems.push(`names environment ${job.environment}`);
  if (isRemoteCall(job.uses)) problems.push(`calls remote reusable workflow ${job.uses}`);
  const callee = localCallee(job.uses);
  if (callee) {
    const target = workflows.get(callee);
    if (!target) problems.push(`calls missing reusable workflow ${callee}`);
    else if (!seen.has(callee)) {
      seen.add(callee);
      for (const inner of target.jobs) {
        for (const p of exposureOf(workflows, target, inner, seen)) problems.push(`calls ${callee} whose job ${inner.id} ${p}`);
      }
    }
  }
  return problems;
}

/** The events that can start a job: its workflow's own events, or its callers' when reached through workflow_call. */
function reachingEvents(workflows, workflow, job, seen = new Set()) {
  const events = new Set(Object.keys(workflow.triggers).filter((e) => e !== 'workflow_call'));
  if ('workflow_call' in workflow.triggers && !seen.has(workflow.file)) {
    seen.add(workflow.file);
    for (const caller of workflows.values()) {
      for (const callerJob of caller.jobs) {
        if (localCallee(callerJob.uses) === workflow.file) {
          for (const e of reachingEvents(workflows, caller, callerJob, seen)) events.add(e);
        }
      }
    }
  }
  if (dispatchOnlyGuard(job.if)) return new Set([...events].filter((e) => e === 'workflow_dispatch'));
  return events;
}

const requiredEnvironment = (secret) => CREDENTIAL_CLASSES.find((c) => c.pattern.test(secret))?.environment ?? null;
const sharedSecretsOf = (job) => job.secrets.filter((s) => SHARED_DATA_SECRET.test(s));

export function evaluate(workflows) {
  const violations = [];
  const add = (rule, file, job, detail) => violations.push({ rule, file, job, detail });
  for (const workflow of workflows.values()) {
    const events = Object.keys(workflow.triggers);
    for (const event of events.filter((e) => PRIVILEGED_EVENTS.includes(e))) {
      add(RULES.PRIVILEGED, workflow.file, null, `triggered by ${event}`);
    }
    const prEvents = events.filter((e) => PR_CONTEXT_EVENTS.includes(e));
    if (prEvents.length) {
      for (const job of workflow.jobs) {
        for (const problem of exposureOf(workflows, workflow, job)) {
          add(RULES.PR_SECRET, workflow.file, job.id, `${prEvents.join('/')} can start it and it ${problem}`);
        }
      }
    }
    for (const job of workflow.jobs) {
      const shared = sharedSecretsOf(job);
      if (!shared.length && !(job.dynamic && events.some((e) => !PR_CONTEXT_EVENTS.includes(e)))) continue;
      const reach = reachingEvents(workflows, workflow, job);
      const forbidden = [...reach].filter((e) => !SHARED_DATA_EVENTS.has(e));
      const holds = shared.length ? shared.join(', ') : 'dynamically read secrets';
      if (forbidden.length) add(RULES.SHARED_REACH, workflow.file, job.id, `${forbidden.join('/')} can start a job holding ${holds}`);
      if (reach.has('workflow_dispatch') || reach.has('schedule')) {
        const required = [...new Set(shared.map(requiredEnvironment).filter(Boolean))];
        if (required.length > 1) {
          add(RULES.SHARED_APPROVAL, workflow.file, job.id, `mixes ${required.join(' and ')} credentials in one job`);
        } else if (required.length === 1 && (job.environment ?? '').toLowerCase() !== required[0]) {
          if (job.uses) {
            const target = workflows.get(localCallee(job.uses));
            const ungated = (target?.jobs ?? []).filter((j) => (j.environment ?? '').toLowerCase() !== required[0]);
            if (!target || ungated.length) add(RULES.SHARED_APPROVAL, workflow.file, job.id, `passes ${holds} to a workflow not gated by ${required[0]}`);
          } else {
            add(RULES.SHARED_APPROVAL, workflow.file, job.id, `holds ${holds} without environment: ${required[0]}`);
          }
        }
      }
    }
  }
  return { violations };
}

export function prEventReach(workflows) {
  const jobs = [];
  for (const workflow of workflows.values()) {
    const events = Object.keys(workflow.triggers).filter((e) => PR_CONTEXT_EVENTS.includes(e) || PRIVILEGED_EVENTS.includes(e));
    if (!events.length) continue;
    const visit = (owner, job, via) => {
      jobs.push({
        file: owner.file,
        job: job.id,
        via,
        events,
        secrets: job.secrets.filter((s) => !ALLOWED_PR_SECRETS.has(s)),
        inherits: job.inherits,
        dynamic: job.dynamic,
        environment: job.environment,
        remote: isRemoteCall(job.uses) ? job.uses : null,
      });
      const callee = localCallee(job.uses);
      const target = callee && workflows.get(callee);
      if (target && !via.includes(callee)) for (const inner of target.jobs) visit(target, inner, [...via, callee]);
    };
    for (const job of workflow.jobs) visit(workflow, job, []);
  }
  return { jobs };
}

export function pushReach(workflows, branch) {
  const jobs = [];
  for (const workflow of workflows.values()) {
    const push = workflow.triggers.push;
    if (!push) continue;
    const onlyTags = !push.branches && !push['branches-ignore'] && (push.tags || push['tags-ignore']);
    if (onlyTags) continue;
    if (push.branches && !matchesFilters(push.branches, branch)) continue;
    if (push['branches-ignore'] && matchesFilters(push['branches-ignore'], branch)) continue;
    const visit = (owner, job, via) => {
      if (dispatchOnlyGuard(job.if)) return;
      jobs.push({ file: owner.file, job: job.id, via, sharedSecrets: sharedSecretsOf(job), dynamic: job.dynamic });
      const callee = localCallee(job.uses);
      const target = callee && workflows.get(callee);
      if (target && !via.includes(callee)) for (const inner of target.jobs) visit(target, inner, [...via, callee]);
    };
    for (const job of workflow.jobs) visit(workflow, job, []);
  }
  return jobs;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────

function main(argv) {
  const args = { workflows: '.github/workflows', pushBranches: [], report: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--workflows') args.workflows = argv[++i];
    else if (argv[i] === '--push-branch') args.pushBranches.push(argv[++i]);
    else if (argv[i] === '--report') args.report = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  const workflows = loadWorkflows(path.resolve(args.workflows));
  const { violations } = evaluate(workflows);
  const pr = prEventReach(workflows);
  const exposed = pr.jobs.filter((j) => j.secrets.length || j.inherits || j.dynamic || j.environment || j.remote);
  const pushes = args.pushBranches.map((branch) => {
    const reached = pushReach(workflows, branch);
    return { branch, jobs: reached.length, sharedDataJobs: reached.filter((j) => j.sharedSecrets.length || j.dynamic) };
  });
  const report = {
    policy: 'CARUP-PAY-05 workflow secret isolation',
    rules: RULES,
    head_sha: process.env.GITHUB_SHA ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? null,
    workflows_scanned: workflows.size,
    violations,
    pull_request_dry_run: {
      workflows: [...new Set(pr.jobs.map((j) => j.file))].length,
      jobs: pr.jobs.length,
      jobs_with_secret_or_environment_access: exposed,
    },
    push_dry_run: pushes,
  };
  if (args.report) writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`workflows scanned: ${workflows.size}`);
  console.log(`policy violations: ${violations.length}`);
  for (const v of violations) console.log(`  ${v.rule} ${v.file}${v.job ? `#${v.job}` : ''}: ${v.detail}`);
  console.log(`pull-request dry run: ${pr.jobs.length} jobs in ${report.pull_request_dry_run.workflows} workflows; ${exposed.length} with secret or environment access`);
  for (const j of exposed) console.log(`  EXPOSED ${j.file}#${j.job}`);
  for (const p of pushes) {
    console.log(`push dry run ${p.branch}: ${p.jobs} jobs; ${p.sharedDataJobs.length} with shared-data credentials`);
    for (const j of p.sharedDataJobs) console.log(`  REACHES ${j.file}#${j.job}: ${j.sharedSecrets.join(', ')}`);
  }
  const failed = violations.length || exposed.length || pushes.some((p) => p.sharedDataJobs.length);
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
