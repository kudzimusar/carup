import { CommunicationTemplateService } from './communicationTemplateService.js';

function escapeValue(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceVariables(text, variables) {
  return String(text || '').replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => escapeValue(variables[key] ?? ''));
}

export class CommunicationGovernedTemplateService {
  constructor({ repository, fallbackService = null } = {}) {
    this.repository = repository;
    this.fallbackService = fallbackService || new CommunicationTemplateService();
  }

  async getApprovedVersion(templateKey, { channel = 'in_app', language = 'en' } = {}) {
    if (!this.repository) return null;
    try {
      const template = await this.repository.findOne('communication_templates', {
        template_key: templateKey,
        status: 'active',
      });
      if (!template) return null;
      const versions = (await this.repository.list('communication_template_versions', { template_id: template.id }))
        .filter((row) => row.approval_status === 'approved')
        .filter((row) => row.language === language)
        .filter((row) => row.channel === channel || row.channel === 'default')
        .sort((a, b) => {
          const channelRank = Number(b.channel === channel) - Number(a.channel === channel);
          return channelRank || Number(b.version || 0) - Number(a.version || 0);
        });
      return versions[0] ? { template, version: versions[0] } : null;
    } catch (_error) {
      // Compatibility boundary: before the registry migration is present, the proven
      // in-code template map remains available. Once a DB template/version exists, it
      // is authoritative and this fallback is not used.
      return null;
    }
  }

  assertRequiredVariables(version, variables) {
    const required = Array.isArray(version.required_variables) ? version.required_variables : [];
    const missing = required.filter((key) => variables[key] === undefined || variables[key] === null || variables[key] === '');
    if (missing.length) {
      const error = new Error(`Template ${version.id || 'version'} missing required variables: ${missing.join(', ')}`);
      error.code = 'template_variables_missing';
      throw error;
    }
  }

  async render(templateKey, variables = {}, options = {}) {
    const governed = await this.getApprovedVersion(templateKey, options);
    if (!governed) return this.fallbackService.render(templateKey, variables);
    this.assertRequiredVariables(governed.version, variables);
    const subject = replaceVariables(governed.version.subject_template, variables);
    const body = replaceVariables(governed.version.body_template, variables);
    return {
      templateKey,
      templateId: governed.template.id,
      templateVersionId: governed.version.id,
      version: governed.version.version,
      channel: governed.version.channel,
      language: governed.version.language,
      classification: governed.template.classification,
      transactional: governed.template.classification !== 'marketing',
      providerTemplateReference: governed.version.provider_template_reference || null,
      subject,
      body,
      text: body,
      data: variables,
      governed: true,
    };
  }

  async listTemplates() {
    if (!this.repository) return this.fallbackService.listTemplates();
    try {
      const rows = await this.repository.list('communication_templates', { status: 'active' });
      return rows.map((row) => row.template_key);
    } catch (_error) {
      return this.fallbackService.listTemplates();
    }
  }
}
