/**
 * R6 test helper: an in-memory model of the shared PostgreSQL reviewer step-up guard
 * (dealer_begin_reviewer_step_up / dealer_complete_reviewer_step_up, migration 20261103145000).
 * It mirrors the SQL contract (5 reserved attempts, 5th failure locks, success resets) so service
 * tests exercise the real requireReviewerPassword path instead of bypassing the lockout.
 * The SQL implementation itself is proven in database/test/dealer_1_0_pglite_check.mjs.
 */
export const STEP_UP_GUARD_RPCS = Object.freeze([
  'dealer_begin_reviewer_step_up',
  'dealer_complete_reviewer_step_up',
]);

export function createStepUpGuardModel({ maxAttempts = 5, lockSeconds = 900 } = {}) {
  const state = new Map();
  const calls = [];
  function begin(id) {
    calls.push(['begin', id]);
    if (typeof id !== 'string' || !id) return { data: null, error: { message: 'REVIEWER_STEP_UP_SUBJECT_REQUIRED' } };
    const g = state.get(id) || { attempts: 0, locked: false, lockouts: 0 };
    state.set(id, g);
    if (g.locked) return { data: { allowed: false, retry_after_seconds: lockSeconds }, error: null };
    if (g.attempts >= maxAttempts) {
      g.locked = true; g.lockouts += 1;
      return { data: { allowed: false, retry_after_seconds: lockSeconds }, error: null };
    }
    g.attempts += 1;
    return { data: { allowed: true, attempt: g.attempts, max_attempts: maxAttempts }, error: null };
  }
  function complete(id, ok) {
    calls.push(['complete', id, ok]);
    const g = state.get(id);
    if (!g) return { data: null, error: { message: 'REVIEWER_STEP_UP_NOT_STARTED' } };
    if (ok === true) { g.attempts = 0; g.locked = false; }
    else if (g.attempts >= maxAttempts && !g.locked) { g.locked = true; g.lockouts += 1; }
    return { data: { locked: g.locked, attempts_in_window: g.attempts }, error: null };
  }
  return {
    state,
    calls,
    handles: (name) => STEP_UP_GUARD_RPCS.includes(name),
    rpc(name, args = {}) {
      return name === 'dealer_begin_reviewer_step_up'
        ? begin(args.p_reviewer_id)
        : complete(args.p_reviewer_id, args.p_succeeded);
    },
  };
}

/** Wrap a test's rpc mock so the two guard RPCs are answered by the model; others pass through. */
export function withStepUpGuard(rpc = async (name) => { throw new Error('Unexpected rpc ' + name); },
  model = createStepUpGuardModel()) {
  const wrapped = async function stepUpAwareRpc(name, args) {
    if (model.handles(name)) return model.rpc(name, args);
    return rpc.call(this, name, args);
  };
  wrapped.stepUpModel = model;
  return wrapped;
}

/**
 * For legacy service tests that assign `supabase.rpc = async (name) => {...}` with strict name
 * assertions: transparently route the two guard RPCs to a fresh model on every assignment, so
 * those tests keep asserting their own RPC contract while the real step-up path (reservation,
 * verification, completion) still runs. Returns an uninstall function.
 */
export function installStepUpGuardModel(client) {
  const descriptor = Object.getOwnPropertyDescriptor(client, 'rpc');
  let current = withStepUpGuard(client.rpc);
  Object.defineProperty(client, 'rpc', {
    configurable: true,
    enumerable: true,
    get() { return current; },
    set(value) { current = value && value.stepUpModel ? value : withStepUpGuard(value); },
  });
  return () => {
    if (descriptor) Object.defineProperty(client, 'rpc', descriptor);
    else delete client.rpc;
  };
}
