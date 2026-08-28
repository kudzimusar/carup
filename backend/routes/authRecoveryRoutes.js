import crypto from 'crypto';
import express from 'express';

import { supabase } from '../db/supabase.js';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import { hashPassword } from '../utils/passwordAuth.js';
import {
  AUTH_TOKEN_PURPOSES,
  createAuthActionTokenService,
} from '../services/auth/authActionTokenService.js';
import { AUTH_ROUTES, buildAuthActionUrl } from '../services/communication/authEmailTemplates.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';
import { emitDomainEvent } from '../services/eventBus/eventBusService.js';
import { EMAIL_VERIFIED_EVENT } from '../services/communication/producers/leadershipWelcomeProducer.js';

/**
 * SA1D — password recovery and email verification for CarUp's own auth.
 *
 * These endpoints sit alongside the existing custom auth (public.users -> public.user_sessions)
 * and deliberately do not change the login token format or the session contract.
 *
 * Two properties drive the shape of this file:
 *
 *  1. **No account enumeration.** /forgot-password returns the same body and status for a known
 *     address, an unknown address, an address with no password set, and a provider failure. The
 *     only thing that differs is what happens server-side. Timing is smoothed by doing the same
 *     hash work either way, so response time does not leak existence either.
 *  2. **Atomic, single-use tokens.** Redemption consumes the token in one conditional UPDATE, so
 *     a replayed link cannot reset a password twice.
 */

const GENERIC_FORGOT_RESPONSE = Object.freeze({
  success: true,
  message: 'If an account exists for that email address, a password reset link has been sent.',
});

const MIN_PASSWORD_LENGTH = 8;

/** Same normalisation the existing login lookup relies on, plus trimming. */
function normalizeEmail(value) {
  return String(value || '').trim();
}

function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Burn a comparable amount of CPU when no account exists, so an attacker cannot distinguish a
 * known from an unknown address by response latency.
 */
async function equivalentWorkForUnknownAccount() {
  await new Promise((resolve) => {
    crypto.scrypt(crypto.randomBytes(16).toString('hex'), crypto.randomBytes(16).toString('hex'), 64, () => resolve());
  });
}

export function authRecoveryRouter({
  db = supabase,
  tokenService = createAuthActionTokenService({ supabase: db }),
  services = null,
  env = process.env,
  // The durable post-verification handoff. Injected like every other collaborator in this router so
  // a test can drive the real chain — route -> outbox row -> orchestrator -> R1 producer — instead
  // of asserting that a side effect was attempted.
  emitEvent = emitDomainEvent,
} = {}) {
  const router = express.Router();
  const comms = () => services || createCommunicationServices({ env });

  /**
   * Queue a P0 auth/security Email through canonical CarUp Communications.
   *
   * Auth Email never bypasses the queue: it must appear in canonical audit, delivery attempts and
   * quota governance like any other message. Delivery is Resend (never Brevo — marketing only).
   */
  async function queueAuthEmail({ user, templateKey, authTemplateKey, variables }) {
    const { notificationService } = comms();
    return notificationService.queueNotification({
      recipientUserId: user.id,
      notificationType: templateKey,
      channel: 'email',
      templateKey,
      language: 'en',
      priority: 'high',
      transactional: true,
      // Account protection is `security`. There is deliberately no `auth` classification.
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

  // --- Request a password reset -------------------------------------------------------------
  router.post(
    '/api/auth/forgot-password',
    rateLimiter({ max: 5, windowMs: 15 * 60 * 1000, isSensitive: true }),
    async (req, res) => {
      const email = normalizeEmail(req.body?.email);
      if (!email) {
        // Still generic: a missing field must not be a probe oracle either.
        return res.status(200).json(GENERIC_FORGOT_RESPONSE);
      }

      try {
        const { data: user } = await db
          .from('users')
          .select('id, email, name, password_hash')
          .eq('email', email)
          .maybeSingle();

        if (!user) {
          await equivalentWorkForUnknownAccount();
          return res.status(200).json(GENERIC_FORGOT_RESPONSE);
        }

        const { rawToken } = await tokenService.issue({
          userId: user.id,
          purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET,
          requestedIp: req.carupClientIp || req.ip || null,
          userAgent: req.headers?.['user-agent'] || null,
          source: 'forgot_password',
        });

        const actionUrl = buildAuthActionUrl({ route: AUTH_ROUTES.RESET_PASSWORD, token: rawToken, env });

        await queueAuthEmail({
          user,
          templateKey: 'auth_password_reset_v1',
          authTemplateKey: 'reset_password',
          variables: { action_url: actionUrl, dedupe_nonce: crypto.randomUUID() },
        });

        return res.status(200).json(GENERIC_FORGOT_RESPONSE);
      } catch (error) {
        // A provider or database failure must not reveal whether the account exists.
        console.error('[auth] forgot-password failed:', error?.message);
        return res.status(200).json(GENERIC_FORGOT_RESPONSE);
      }
    },
  );

  // --- Complete a password reset --------------------------------------------------------------
  router.post(
    '/api/auth/reset-password',
    rateLimiter({ max: 10, windowMs: 15 * 60 * 1000, isSensitive: true }),
    async (req, res) => {
      const token = req.body?.token;
      const password = req.body?.password;

      const policyError = passwordPolicyError(password);
      if (policyError) return res.status(400).json({ error: policyError });

      const consumed = await tokenService.consume({
        rawToken: token,
        purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET,
      });

      if (!consumed.ok) {
        // One opaque message for expired / used / unknown / wrong-purpose / malformed, so a
        // replayed or guessed token yields no information about why it failed.
        return res.status(400).json({ error: 'This password reset link is invalid or has expired. Please request a new one.' });
      }

      try {
        const passwordHash = await hashPassword(password);

        const { error: updateError } = await db
          .from('users')
          .update({ password_hash: passwordHash })
          .eq('id', consumed.token.user_id);
        if (updateError) throw new Error(updateError.message);

        // Revoke every existing session: a password reset must sign out anyone holding the old
        // credential, including an attacker with a live session.
        const { error: sessionError } = await db
          .from('user_sessions')
          .update({ is_valid: false })
          .eq('user_id', consumed.token.user_id)
          .eq('is_valid', true);
        if (sessionError) console.error('[auth] session revocation after reset failed:', sessionError.message);

        // Any other live reset token for this user is now moot.
        await tokenService.revokeLiveTokens({
          userId: consumed.token.user_id,
          purpose: AUTH_TOKEN_PURPOSES.PASSWORD_RESET,
        });

        const { data: user } = await db
          .from('users')
          .select('id, email, name')
          .eq('id', consumed.token.user_id)
          .maybeSingle();

        if (user) {
          try {
            await queueAuthEmail({
              user,
              templateKey: 'auth_password_changed_v1',
              authTemplateKey: 'password_changed',
              variables: { dedupe_nonce: crypto.randomUUID() },
            });
          } catch (notifyError) {
            // The reset itself already succeeded; a notification failure must not undo it.
            console.error('[auth] password-changed notification failed:', notifyError?.message);
          }
        }

        // Deliberately does NOT sign the user in: they return to /login and authenticate with the
        // new password, which also proves the reset worked.
        return res.status(200).json({ success: true, message: 'Your password has been reset. Please sign in with your new password.' });
      } catch (error) {
        console.error('[auth] reset-password failed:', error?.message);
        return res.status(500).json({ error: 'Could not reset the password. Please request a new reset link.' });
      }
    },
  );

  // --- Verify an email address ----------------------------------------------------------------
  router.post(
    '/api/auth/verify-email',
    rateLimiter({ max: 10, windowMs: 15 * 60 * 1000, isSensitive: true }),
    async (req, res) => {
      const consumed = await tokenService.consume({
        rawToken: req.body?.token,
        purpose: AUTH_TOKEN_PURPOSES.EMAIL_VERIFICATION,
      });
      if (!consumed.ok) {
        return res.status(400).json({ error: 'This verification link is invalid or has expired. Please request a new one.' });
      }

      const { error } = await db
        .from('users')
        .update({ email_verified_at: new Date().toISOString() })
        .eq('id', consumed.token.user_id);
      if (error) {
        console.error('[auth] verify-email failed:', error.message);
        return res.status(500).json({ error: 'Could not verify this email address. Please request a new link.' });
      }

      // R1 — the Leadership Welcome, as DURABLE WORK rather than a best-effort side effect.
      //
      // The trigger is VERIFICATION, not registration. An unverified address may not belong to the
      // person who typed it, and a welcome is the wrong first thing to send somewhere nobody has
      // proven they can receive mail.
      //
      // This used to call the producer inline and swallow its failure. The verification token is
      // single-use and has already been consumed by this point, so the operation cannot be replayed:
      // a transient fault anywhere in that pipeline meant the account permanently never received its
      // welcome, with nothing recording that one was owed. That was the only production call site.
      //
      // Writing an outbox event instead moves the durability boundary from "the whole notification
      // pipeline succeeded first time" to "one row was inserted". Everything after it — the user
      // lookup, the template render, the thread resolve, the notification insert — is retried by the
      // event worker until it succeeds or visibly dead-letters. The event carries a deterministic
      // dedupe key per user, and the notification carries its own, so however many times this is
      // replayed exactly one welcome exists.
      //
      // Still non-blocking, and deliberately so: an Email outage must never turn a successful
      // verification into an error the customer sees, and must never change the account-verification
      // security semantics.
      //
      // The event type is written as a LITERAL here on purpose. The coverage gate greps for an
      // emitDomainEvent call with a quoted event type, and it is right to: a constant makes an
      // emitter invisible to the very check that exists to prove emitters are real. The exported
      // constant remains the public identity, and a test pins that the two agree.
      await emitEvent(null, 'user.email.verified', {
        recipientUserId: consumed.token.user_id,
      }, null).catch((welcomeError) => {
        console.error('[auth] post-verification welcome event could not be recorded:', welcomeError.message);
      });

      return res.status(200).json({ success: true, message: 'Your email address has been verified.' });
    },
  );

  return router;
}

export default authRecoveryRouter;
