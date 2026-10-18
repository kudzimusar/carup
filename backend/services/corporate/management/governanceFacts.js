/**
 * CA-OWNER-02 (A) — the Corporate governance position for the Overview.
 *
 * Read THROUGH the frozen People & Access projection (projectCorporatePeopleAccess), so the Overview can never show more
 * than People & Access shows the same actor: the counts cover exactly the organisation nodes the trusted evaluator confirms
 * the actor governs (corporate.people.membership.manage). These are governance records of the persistent Corporate
 * authority — the one kind of figure that is a governed actual. An actor who governs nothing sees FORBIDDEN, never a count.
 */
import { projectCorporatePeopleAccess } from '../corporatePeopleAccessService.js';
import { liveFact, statementFact, degradedFact, CURRENT_WINDOW } from './managementFact.js';

const SOURCE = 'corporate_memberships + corporate_permission_assignments · People & Access projection (trusted evaluator)';
const LABELS = Object.freeze({
  'corporate.governance.membership.active': 'Active Corporate memberships',
  'corporate.governance.assignment.active': 'Active persistent permission assignments',
});

export async function readGovernanceFacts(client, { now = new Date(), actorUserId, project = projectCorporatePeopleAccess } = {}) {
  let result;
  try {
    result = await project(client, { actorUserId, now });
  } catch {
    result = { status: 503 };
  }
  const ids = Object.keys(LABELS);
  if (result?.status === 200 && result.body?.counts) {
    const nodes = (result.body.basis?.governed_nodes || []).map((n) => n.node_id).join(', ') || 'none';
    const scope = `Organisation nodes you govern: ${nodes}`;
    const common = { kind: 'governance', source: { authority: SOURCE }, asOf: result.body.generated_at || now, scope, window: CURRENT_WINDOW };
    return {
      facts: [
        liveFact({ ...common, id: ids[0], label: LABELS[ids[0]], value: result.body.counts.memberships, detail: 'ACTIVE and inside its effective window.' }),
        liveFact({ ...common, id: ids[1], label: LABELS[ids[1]], value: result.body.counts.assignments, detail: 'ACTIVE persistent assignments resting on those memberships.' }),
      ],
    };
  }
  if (result?.status === 403) {
    return {
      facts: ids.map((id) => statementFact({
        id, label: LABELS[id], state: 'FORBIDDEN',
        reason: 'Viewing Corporate governance requires a persistent corporate.people.membership.manage assignment over the nodes concerned.',
      })),
    };
  }
  return {
    facts: ids.map((id) => degradedFact(
      { id, label: LABELS[id], kind: 'governance', source: { authority: SOURCE }, asOf: now, window: CURRENT_WINDOW },
      'The Corporate access record could not be read right now, so no value is shown.',
    )),
  };
}
