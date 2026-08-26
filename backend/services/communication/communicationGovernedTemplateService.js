import { CommunicationTemplateService } from './communicationTemplateService.js';
import { substituteVariables } from './templateVariableSubstitution.js';

// Escaping is owned by the representation, not by substitution — see templateVariableSubstitution.js.
function replaceVariables(text, variables) {
  return substituteVariables(text, variables);
}

function governanceError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  // A governed template that is inactive, or has no approved version for the requested
  // channel/language, is a refusal the caller can act on — not a server fault. Without a
  // status these reached the client as 500: asking for a campaign on a channel the template
  // has no approved version for looked like an outage instead of governance saying no.
  error.statusCode = 409;
  return error;
}

function isRegistryUnavailableError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  // Compatibility fallback is intentionally narrow: only a genuinely undeployed
  // registry/schema may fall back. Network, permission, timeout and arbitrary SQL
  // failures must surface so governance is not bypassed during an outage.
  return code === '42P01'
    || code === 'PGRST205'
    || (
      message.includes('communication_templates')
      && (
        message.includes('does not exist')
        || message.includes('could not find the table')
        || message.includes('schema cache')
      )
    );
}

export class CommunicationGovernedTemplateService {
  constructor({ repository, fallbackService = null } = {}) {
    this.repository = repository;
    this.fallbackService = fallbackService || new CommunicationTemplateService();
  }

  /**
   * Resolve a governed template without allowing approval state to be bypassed.
   *
   * Compatibility fallback is permitted only when the governed registry itself is not
   * deployed. Once the registry exists, every runtime key must be registered, active
   * and backed by an approved channel/language version. Draft, retired, unapproved and
   * unregistered keys therefore fail closed.
   */
  async resolveGovernedVersion(templateKey, { channel = 'in_app', language = 'en' } = {}) {
    if (!this.repository) return { registryAvailable: false, template: null, version: null };
    try {
      const template = await this.repository.findOne('communication_templates', {
        template_key: templateKey,
      });
      if (!template) return { registryAvailable: true, template: null, version: null };
      if (template.status !== 'active') {
        throw governanceError(
          'template_not_active',
          `Template ${templateKey} is governed but is not active.`,
          { template_id: template.id, status: template.status },
        );
      }

      const versions = (await this.repository.list('communication_template_versions', { template_id: template.id }))
        .filter((row) => row.approval_status === 'approved')
        .filter((row) => row.language === language)
        .filter((row) => row.channel === channel || row.channel === 'default')
        .sort((a, b) => {
          const channelRank = Number(b.channel === channel) - Number(a.channel === channel);
          return channelRank || Number(b.version || 0) - Number(a.version || 0);
        });

      if (!versions[0]) {
        throw governanceError(
          'template_not_approved',
          `Template ${templateKey} has no approved ${language}/${channel} (or default) version.`,
          { template_id: template.id, channel, language },
        );
      }
      return { registryAvailable: true, template, version: versions[0] };
    } catch (error) {
      if (error?.code === 'template_not_active' || error?.code === 'template_not_approved') throw error;
      if (isRegistryUnavailableError(error)) {
        return { registryAvailable: false, template: null, version: null };
      }
      throw error;
    }
  }

  assertRequiredVariables(version, variables) {
    const required = Array.isArray(version.required_variables) ? version.required_variables : [];
    const missing = required.filter((key) => variables[key] === undefined || variables[key] === null || variables[key] === '');
    if (missing.length) {
      throw governanceError(
        'template_variables_missing',
        `Template ${version.id || 'version'} missing required variables: ${missing.join(', ')}`,
        { missing_variables: missing },
      );
    }
  }

  async render(templateKey, variables = {}, options = {}) {
    const governed = await this.resolveGovernedVersion(templateKey, options);
    if (!governed.template) {
      if (governed.registryAvailable) {
        throw governanceError(
          'template_not_registered',
          `Template ${templateKey} is not registered in the governed Communications template registry.`,
          { template_key: templateKey },
        );
      }
      // Pre-migration compatibility only: the governed relation itself is absent.
      return this.fallbackService.render(templateKey, variables);
    }

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
    } catch (error) {
      if (isRegistryUnavailableError(error)) return this.fallbackService.listTemplates();
      throw error;
    }
  }
}
