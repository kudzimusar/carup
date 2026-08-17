/**
 * CarUp authentication Email design system (SA1.3 / SA1.I).
 *
 * PATH A (owner-approved 2026-08-17): CarUp's own backend is the authentication authority
 * (public.users -> public.user_sessions). Supabase Auth is NOT used, so these templates render
 * REAL CarUp action URLs carrying a CarUp auth-action token — not Supabase `{{ .TokenHash }}`
 * placeholders. They are delivered through CarUp Communications -> Resend so every auth Email
 * participates in canonical audit, delivery attempts and quota governance.
 *
 * Rules encoded here:
 *   - no marketing or promotional copy in an authentication message;
 *   - the durable user-facing link is always a CarUp-owned canonical origin, never
 *     *.vercel.app and never a provider host;
 *   - plain-text meaning is preserved (the canonical message body carries the full meaning);
 *   - 600px max content width, mobile-safe, accessible contrast.
 */
import { resolveCanonicalWebOrigin } from '../../config/canonicalWebOrigin.js';

/**
 * Brand tokens.
 *
 * ACTION uses a deepened CarUp orange rather than the UI's #F97316: white text on #F97316 is
 * ~2.9:1 and fails WCAG AA, while #C2410C reaches ~5.2:1 and still reads as CarUp orange.
 * Authentication Email is exactly where legibility must not be traded for brand saturation.
 */
export const BRAND = Object.freeze({
  INK: '#0F172A',
  BODY: '#334155',
  MUTED: '#64748B',
  ACTION: '#C2410C',
  ACTION_TEXT: '#FFFFFF',
  SURFACE: '#FFFFFF',
  CANVAS: '#F1F5F9',
  BORDER: '#E2E8F0',
  MAX_WIDTH: 600,
});

/** Frontend routes that consume an auth action token (implemented in SA1E). */
export const AUTH_ROUTES = Object.freeze({
  RESET_PASSWORD: '/auth/reset-password',
  VERIFY_EMAIL: '/auth/verify-email',
  FORGOT_PASSWORD: '/auth/forgot-password',
});

/**
 * Build the canonical, CarUp-owned action link for an auth Email.
 *
 * The origin comes from the governed `resolveCanonicalWebOrigin()` resolver, so it is always a
 * CarUp canonical host (production -> carup.dev, staging -> staging.carup.dev) and can never be
 * moved off the CarUp domain family by configuration or caller input.
 */
export function buildAuthActionUrl({ route, token, env = process.env }) {
  const origin = resolveCanonicalWebOrigin(env);
  const path = route || AUTH_ROUTES.RESET_PASSWORD;
  if (!token) return `${origin}${path}`;
  return `${origin}${path}?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function layout({ preheader, heading, intro, actionLabel, actionUrl, body = '', securityNote, footerNote }) {
  const safeUrl = actionUrl ? escapeHtml(actionUrl) : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.CANVAS};">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.CANVAS};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="${BRAND.MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${BRAND.MAX_WIDTH}px;background:${BRAND.SURFACE};border:1px solid ${BRAND.BORDER};border-radius:12px;">
<tr><td style="padding:32px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="font-size:20px;font-weight:700;color:${BRAND.INK};letter-spacing:-0.01em;">Car<span style="color:${BRAND.ACTION};">Up</span></div>
</td></tr>
<tr><td style="padding:16px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;color:${BRAND.INK};">${escapeHtml(heading)}</h1>
<p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:${BRAND.BODY};">${intro}</p>
${body}
</td></tr>
${safeUrl ? `<tr><td style="padding:4px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${BRAND.ACTION};border-radius:8px;">
<a href="${safeUrl}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:${BRAND.ACTION_TEXT};text-decoration:none;">${escapeHtml(actionLabel)}</a>
</td></tr></table>
<p style="margin:18px 0 0 0;font-size:13px;line-height:1.6;color:${BRAND.MUTED};">If the button does not work, copy and paste this link into your browser:<br>
<span style="color:${BRAND.BODY};word-break:break-all;">${safeUrl}</span></p>
</td></tr>` : ''}
<tr><td style="padding:20px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<p style="margin:0;padding:14px 16px;background:${BRAND.CANVAS};border-radius:8px;font-size:13px;line-height:1.6;color:${BRAND.BODY};">${securityNote}</p>
</td></tr>
<tr><td style="padding:24px 32px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-top:1px solid ${BRAND.BORDER};">
<p style="margin:16px 0 0 0;font-size:12px;line-height:1.6;color:${BRAND.MUTED};">${footerNote}</p>
<p style="margin:10px 0 0 0;font-size:12px;line-height:1.6;color:${BRAND.MUTED};">CarUp Automotive Intelligence &middot; This is an automated security message. Please do not reply.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const NO_ACTION_EXPECTED = 'If you did not request this, you can safely ignore this email — no changes have been made to your account.';
const SECURITY_ALERT = 'If you did not make this change, secure your account immediately and contact CarUp support.';

/**
 * Authentication templates.
 *
 * `build(env, vars)` receives `vars.action_url` (already built by the caller from a real
 * auth-action token) so the token is generated exactly once, at issue time.
 */
export const AUTH_EMAIL_TEMPLATES = Object.freeze({
  reset_password: {
    templateKey: 'auth_password_reset_v1',
    category: 'authentication',
    classification: 'security',
    subject: 'Reset your CarUp password',
    requiresActionUrl: true,
    build: (env, vars = {}) => layout({
      preheader: 'Reset the password for your CarUp account.',
      heading: 'Reset your password',
      intro: 'A password reset was requested for your CarUp account. Choose a new password using the button below.',
      actionLabel: 'Reset password',
      actionUrl: vars.action_url || buildAuthActionUrl({ route: AUTH_ROUTES.RESET_PASSWORD, env }),
      securityNote: `This reset link can be used once and expires within the hour. Your current password stays active until you choose a new one. ${NO_ACTION_EXPECTED}`,
      footerNote: 'You are receiving this because a password reset was requested for this email address.',
    }),
  },

  confirm_signup: {
    templateKey: 'auth_email_verification_v1',
    category: 'authentication',
    classification: 'security',
    subject: 'Confirm your CarUp account',
    requiresActionUrl: true,
    build: (env, vars = {}) => layout({
      preheader: 'Confirm your email address to activate your CarUp account.',
      heading: 'Confirm your email address',
      intro: 'Welcome to CarUp. Confirm this email address to secure your account and keep access to it if you ever need to reset your password.',
      actionLabel: 'Confirm email address',
      actionUrl: vars.action_url || buildAuthActionUrl({ route: AUTH_ROUTES.VERIFY_EMAIL, env }),
      securityNote: `This confirmation link can be used once and expires within 24 hours. ${NO_ACTION_EXPECTED}`,
      footerNote: 'You are receiving this because an account was created with this email address on CarUp.',
    }),
  },

  password_changed: {
    templateKey: 'auth_password_changed_v1',
    category: 'security_notification',
    classification: 'security',
    subject: 'Your CarUp password was changed',
    requiresActionUrl: false,
    build: () => layout({
      preheader: 'The password on your CarUp account was changed.',
      heading: 'Your password was changed',
      intro: 'The password for your CarUp account was changed, and any existing sessions were signed out. If this was you, no further action is needed.',
      securityNote: SECURITY_ALERT,
      footerNote: 'You are receiving this because of a security change on your CarUp account.',
    }),
  },
});

/**
 * Security notifications for capabilities CarUp does NOT currently support.
 *
 * Kept defined so the design system is complete, but `enabledByDefault:false` and marked
 * NOT reconciled: SA1 forbids enabling a security flow the product does not actually have.
 * CarUp has no phone-auth, no MFA enrolment and no change-email flow today.
 */
export const UNRECONCILED_SECURITY_TEMPLATES = Object.freeze({
  email_changed: { enabledByDefault: false, requiresCapability: 'email change (NOT reconciled — no change-email flow exists)' },
  phone_changed: { enabledByDefault: false, requiresCapability: 'phone auth (NOT reconciled — no phone auth flow exists)' },
  mfa_factor_added: { enabledByDefault: false, requiresCapability: 'MFA (NOT reconciled — no MFA enrolment exists)' },
  mfa_factor_removed: { enabledByDefault: false, requiresCapability: 'MFA (NOT reconciled — no MFA enrolment exists)' },
});

/** Render one template's subject + HTML. `vars.action_url` supplies the real one-time link. */
export function renderAuthEmail(key, env = process.env, vars = {}) {
  const tpl = AUTH_EMAIL_TEMPLATES[key];
  if (!tpl) throw new Error(`Unknown auth email template: ${key}`);
  return {
    subject: tpl.subject,
    html: tpl.build(env, vars),
    category: tpl.category,
    classification: tpl.classification,
    templateKey: tpl.templateKey,
  };
}

export function listAuthEmailTemplateKeys() {
  return Object.keys(AUTH_EMAIL_TEMPLATES);
}
