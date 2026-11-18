// Test double for the transactional PostgreSQL RPC, not a concurrency proof.
export async function mockIdentityClaim(client, name, p) {
  if (name !== 'claim_verification_ocr_submission') throw new Error(`Unexpected RPC: ${name}`);
  const row = client.data.verification_sessions.find(x => x.id === p.p_session_id && x.user_id === p.p_user_id);
  const expired = row?.status === 'ocr_pending' && row.ocr_started_at && Date.now() - Date.parse(row.ocr_started_at) >= 300000;
  if (!row || row.version !== p.p_expected_version || row.status !== p.p_expected_status || !(['uploaded','ocr_failed'].includes(row.status) || expired) || !row.front_storage_path || !row.selfie_storage_path || (row.double_sided && !row.back_storage_path)) return { data: null, error: null };
  if (client.failAudit) return { data: null, error: { message: 'audit failed' } };
  const stamp = new Date().toISOString();
  const previous = row.status;
  Object.assign(row, { status:'ocr_pending', workflow_phase:'system_processing', submitted_at:row.submitted_at || stamp,
    ocr_started_at:stamp, updated_at:stamp, failure_reason:null, ocr_confirmed_at:null, ocr_confirmation_required:false, version:row.version+1 });
  client.data.trust_audit_events.push({ event_type:'VERIFICATION_SUBMITTED', actor_user_id:p.p_user_id, previous_value:{ status:previous }, new_value:{ status:'ocr_pending' } });
  return { data: JSON.parse(JSON.stringify(row)), error: null };
}

// Test double for the transactional reviewer RPC; real SQL is tested separately.
export async function mockIdentityDecision(data, p) {
  const row = data.verification_sessions.find(x => x.id === p.p_session_id);
  if (!row) return { data: { code: 'NOT_FOUND' }, error: null };
  const decisions = data.verification_decisions ||= [];
  const audits = data.trust_audit_events ||= [];
  if (p.p_decision.idempotency_key) {
    const found = decisions.find(x => x.session_id === row.id && x.idempotency_key === p.p_decision.idempotency_key);
    if (found) return { data: { code: 'REPLAY', decision: structuredClone(found), session: structuredClone(row) }, error: null };
  }
  if (row.version !== p.p_expected_version) return { data: { code: 'STALE' }, error: null };
  if (p.p_decision.decision === 'approve' && row.ocr_confirmation_required && !row.ocr_confirmed_at) return { data: { code: 'CONFIRMATION_REQUIRED' }, error: null };
  const previous = { status: row.status, review_decision: row.review_decision || null, workflow_phase: row.workflow_phase };
  decisions.push(structuredClone(p.p_decision));
  Object.assign(row, structuredClone(p.p_update));
  audits.push({ event_type: p.p_event_type, actor_user_id: p.p_decision.reviewer_id, previous_value: previous, new_value: { status: row.status, decision_id: p.p_decision.id } });
  return { data: { code: 'OK', session: structuredClone(row) }, error: null };
}
