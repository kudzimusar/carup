import crypto from 'crypto';

import {
  AUTH_TOKEN_PURPOSES,
  createAuthActionTokenService,
} from './authActionTokenService.js';
import { AUTH_ROUTES, buildAuthActionUrl } from '../communication/authEmailTemplates.js';
import { createCommunicationServices } from '../communication/communicationServiceFactory.js';

/**
 * One auth/security Email seam shared by registration and recovery.
 *
 * The raw auth token never leaves this function except inside the action URL handed directly to
 * canonical Communications. The database stores only its hash (AuthActionTokenService contract).
 */
export function createAuthEmailService({
  db,
  tokenService = createAuthActionTokenService({ supabase: db }),
  services = null,
  env = process.env,
} = {}) {
  const comms = () => services || createCommunicationServices();

  async function queueAuthEmail({ user, templateKey, authTemplateKey, variables }) {
    if (!user?.id || !user?.email) throw new Error('Auth Email requires a user id and email');
    const { notificationService } = comms();
    return notificationService.queueNotification({
      recipientUserId: user.id,
      notificationType: templateKey,
      channel: 'email',
      templateKey,
      language: 'en',
      priority: 'high',
      transactional: true,
      classification: 'security',
      fallbackChannels: [],
      variables,
      dedupeParts: ['auth', templateKey, user.id, variables.dedupe_nonce],
      payload: {
        email: user.email,
        classification: 'security',
        auth_template_key: authTemplateKey,
        ...variables,
      },
    });
  }

  async function issueEmailVerification({
    user,
    requestedIp = null,
    userAgent = null,
    source = 'registration',
  }) {
    const { rawToken, record } = await tokenService.issue({
      userId: user.id,
      purpose: AUTH_TOKEN_PURPOSES.EMAIL_VERIFICATION,
      requestedIp,
      userAgent,
      source,
    });

    const actionUrl = buildAuthActionUrl({
      route: AUTH_ROUTES.VERIFY_EMAIL,
      token: rawToken,
      env,
    });

    await queueAuthEmail({
      user,
      templateKey: 'auth_email_verification_v1',
      authTemplateKey: 'confirm_signup',
      variables: {
        action_url: actionUrl,
        dedupe_nonce: crypto.randomUUID(),
      },
    });

    return { record };
  }

  return { queueAuthEmail, issueEmailVerification };
}
