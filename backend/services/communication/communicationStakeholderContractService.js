const CONTRACTS = Object.freeze({
  marketplace: { requiredRoles: ['buyer', 'seller'], regulated: false },
  dealer: { requiredRoles: ['buyer', 'dealer'], regulated: false },
  garage: { requiredRoles: ['vehicle_owner', 'garage'], regulated: false },
  parts: { requiredRoles: ['buyer', 'parts_seller'], regulated: false },
  insurance: { requiredRoles: ['vehicle_owner', 'insurer'], regulated: true },
  finance: { requiredRoles: ['applicant', 'lender'], regulated: true },
  diaspora_import: { requiredRoles: ['customer', 'import_coordinator'], regulated: false },
  container_logistics: { requiredRoles: ['customer', 'logistics_provider'], regulated: false },
  referral: { requiredRoles: ['referrer', 'referred_user'], regulated: false },
  government_public_service: { requiredRoles: ['customer', 'government_officer'], regulated: true },
  trust_safety: { requiredRoles: ['customer', 'trust_reviewer'], regulated: true },
  support: { requiredRoles: ['customer', 'support_agent'], regulated: false },
});

function normalizedRole(participant = {}) {
  return String(participant.stakeholder_role || participant.role || '').trim().toLowerCase();
}

export class CommunicationStakeholderContractService {
  constructor({ repository, workflowService } = {}) {
    this.repository = repository;
    this.workflowService = workflowService;
  }

  listContracts() {
    return Object.entries(CONTRACTS).map(([workflow, contract]) => ({
      workflow,
      required_roles: [...contract.requiredRoles],
      regulated: contract.regulated,
      canonical_conversation: true,
    }));
  }

  contractFor(workflow) {
    const key = String(workflow || '').trim();
    const contract = CONTRACTS[key];
    if (!contract) {
      const error = new Error(`Unsupported stakeholder communication workflow: ${key || 'unknown'}.`);
      error.statusCode = 400;
      error.code = 'communication_stakeholder_workflow_unsupported';
      throw error;
    }
    return { workflow: key, ...contract };
  }

  assertParticipants(workflow, participants = []) {
    const contract = this.contractFor(workflow);
    const roles = new Set((Array.isArray(participants) ? participants : []).map(normalizedRole).filter(Boolean));
    const missing = contract.requiredRoles.filter((role) => !roles.has(role));
    if (missing.length) {
      const error = new Error(`${workflow} communication requires participant role(s): ${missing.join(', ')}.`);
      error.statusCode = 400;
      error.code = 'communication_stakeholder_roles_missing';
      error.missing_roles = missing;
      throw error;
    }
    return contract;
  }

  async ensureReferenceFlow(input = {}) {
    const workflow = String(input.workflow || input.business_workflow || '').trim();
    const participants = Array.isArray(input.participants) ? input.participants : [];
    const contract = this.assertParticipants(workflow, participants);
    const subjectId = String(input.subject_id || '').trim();
    if (!subjectId) {
      const error = new Error('subject_id is required for a stakeholder reference conversation.');
      error.statusCode = 400;
      throw error;
    }

    const result = await this.workflowService.ensureBusinessConversation({
      ...input,
      workflow,
      business_workflow: workflow,
      participants: participants.map((participant) => ({
        ...participant,
        stakeholder_role: normalizedRole(participant),
        permissions: { read: true, send: true, ...(participant.permissions || {}) },
      })),
      metadata: {
        ...(input.metadata || {}),
        communications_2_stakeholder_contract: true,
        required_roles: contract.requiredRoles,
        regulated_workflow: contract.regulated,
      },
    });

    const thread = await this.repository.updateById('message_threads', result.thread.id, {
      ai_mode: contract.regulated ? 'draft_only' : (result.thread.ai_mode || 'enabled'),
      assigned_team: input.assigned_team || result.thread.assigned_team || workflow,
      metadata: {
        ...(result.thread.metadata || {}),
        communications_2_stakeholder_contract: true,
        required_roles: contract.requiredRoles,
        regulated_workflow: contract.regulated,
      },
    });

    return { ...result, thread, contract: { workflow, required_roles: contract.requiredRoles, regulated: contract.regulated } };
  }
}

export const communicationStakeholderContracts = CONTRACTS;
