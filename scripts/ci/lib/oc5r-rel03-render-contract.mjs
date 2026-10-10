import { NOTIFICATION_POLICIES, templateVariablesForEvent } from '../../../backend/services/communication/communicationNotificationService.js';

function asArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asPayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function governedTemplateRegistrySql() {
  return `
    SELECT
      t.template_key,
      t.status AS template_status,
      v.id AS template_version_id,
      v.version,
      v.channel,
      v.language,
      v.required_variables,
      v.approval_status
    FROM public.communication_templates t
    LEFT JOIN public.communication_template_versions v ON v.template_id = t.id
    ORDER BY t.template_key, v.version DESC NULLS LAST
  `;
}

export function pendingEligiblePayloadSql() {
  return `
    SELECT id, event_type, status, attempts, tenant_id, created_at, payload
    FROM public.domain_events
    WHERE status = 'pending' AND attempts < $1
    ORDER BY created_at ASC
  `;
}

function selectApprovedVersion(rows, channel, language) {
  return rows
    .filter((row) => row.approval_status === 'approved')
    .filter((row) => row.language === language)
    .filter((row) => row.channel === channel || row.channel === 'default')
    .sort((a, b) => {
      const channelRank = Number(b.channel === channel) - Number(a.channel === channel);
      return channelRank || Number(b.version || 0) - Number(a.version || 0);
    })[0] || null;
}

export function evaluateRenderContract(row, registryRows = [], options = {}) {
  const eventType = String(row?.event_type || '');
  const effectClass = row?.classification?.effect_class || options.effectClass || 'UNKNOWN_REQUIRES_REVIEW';
  const policy = NOTIFICATION_POLICIES[eventType] || null;
  const templateKey = policy?.templateKey || null;
  const channel = options.channel || 'in_app';
  const language = options.language || 'en';
  const candidates = templateKey ? registryRows.filter((item) => item.template_key === templateKey) : [];
  const registered = candidates.length > 0;
  const active = registered && candidates.some((item) => item.template_status === 'active');
  const approved = active ? selectApprovedVersion(candidates, channel, language) : null;
  const required = asArray(approved?.required_variables);
  const variables = templateVariablesForEvent(eventType, asPayload(row?.payload));
  const missing = required.filter((key) => variables[key] === undefined || variables[key] === null || variables[key] === '');
  const ready = Boolean(policy && templateKey && registered && active && approved && missing.length === 0);

  return {
    event_type: eventType,
    effect_class: effectClass,
    template_key: templateKey,
    template_registered: registered,
    template_active: active,
    template_approved: Boolean(approved),
    channel,
    language,
    required_variables: required,
    missing_required_variables: missing,
    render_contract_ready: ready,
    ...(ready ? {} : {
      stop_reason: !policy || !templateKey
        ? 'notification_policy_missing'
        : !registered
          ? 'template_unregistered'
          : !active
            ? 'template_inactive'
            : !approved
              ? 'approved_version_missing'
              : 'required_variables_missing',
    }),
  };
}

export function attachRenderContracts(rows, registryRows = [], classificationByType = new Map()) {
  return (rows || []).map((row) => {
    const classification = row.classification || classificationByType.get(row.event_type) || null;
    return {
      ...row,
      classification,
      render_contract: evaluateRenderContract({ ...row, classification }, registryRows),
    };
  });
}

export function summarizeClassARenderContracts(rows, registryRows = [], classificationByType = new Map(), allowedEffects = ['IN_APP_ONLY', 'AUDIT_ONLY']) {
  const groups = new Map();
  for (const row of rows || []) {
    const classification = row.classification || classificationByType.get(row.event_type) || null;
    const effect = classification?.effect_class || 'UNKNOWN_REQUIRES_REVIEW';
    if (!allowedEffects.includes(effect)) continue;
    const evaluated = evaluateRenderContract({ ...row, classification }, registryRows);
    const group = groups.get(row.event_type) || { rows: [], contracts: [] };
    group.rows.push(row);
    group.contracts.push(evaluated);
    groups.set(row.event_type, group);
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([eventType, group]) => {
    const first = group.contracts[0];
    const missing = [...new Set(group.contracts.flatMap((item) => item.missing_required_variables))].sort();
    const readyCount = group.contracts.filter((item) => item.render_contract_ready).length;
    return {
      event_type: eventType,
      count: group.rows.length,
      effect_class: first?.effect_class || 'UNKNOWN_REQUIRES_REVIEW',
      policy_template: first?.template_key || null,
      template_registered: group.contracts.every((item) => item.template_registered),
      template_approved: group.contracts.every((item) => item.template_approved),
      required_variables: first?.required_variables || [],
      historical_live_rows_checked: group.rows.length,
      historical_live_sample_satisfiable: readyCount === group.rows.length,
      missing_required_variables: missing,
      result: readyCount === group.rows.length ? 'PASS' : 'STOP',
    };
  });
}
