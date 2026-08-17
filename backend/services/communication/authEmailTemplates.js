/**
 * CarUp authentication Email design system (SA1.3).
 *
 * One consistent, email-safe template set for authentication and account-security messages.
 * Deliberately transport-neutral: the same definitions can be rendered into Supabase Auth's
 * template configuration (Supabase variables are preserved verbatim) or rendered by CarUp
 * Communications if auth Email is delivered through the canonical queue instead. Nothing here
 * assumes which of those is in use.
 *
 * Rules encoded here (SA1.3 / SA1.6):
 *   - no marketing or promotional copy in an authentication message;
 *   - the durable user-facing link is always a CarUp-owned canonical origin, never
 *     project-ref.supabase.co and never *.vercel.app;
 *   - plain-text meaning is preserved alongside the HTML;
 *   - 600px max content width, mobile-safe, accessible contrast.
 */
import { resolveCanonicalWebOrigin } from '../../config/canonicalWebOrigin.js';

/**
 * Brand tokens.
 *
 * ACTION uses a deepened CarUp orange rather than the UI's #F97316: white text on #F97316 is
 * ~2.9:1, which fails WCAG AA, while #C2410C reaches ~5.2:1 and still reads as CarUp orange.
 * Authentication Email is exactly where legibility must not be traded for brand saturation.
 */
export const BRAND = Object.freeze({
  INK: '#0F172A',        // headings — deep navy
  BODY: '#334155',       // body copy
  MUTED: '#64748B',      // secondary/legal copy
  ACTION: '#C2410C',     // primary action surface (white text ≈ 5.2:1)
  ACTION_TEXT: '#FFFFFF',
  SURFACE: '#FFFFFF',
  CANVAS: '#F1F5F9',     // outer background
  BORDER: '#E2E8F0',
  MAX_WIDTH: 600,
});

/**
 * The application route that consumes an auth token.
 *
 * NOTE: this route does not exist in the CarUp frontend yet (verified during SA1.0 — the router
 * has /login, /register and /verify-otp only). It is parameterised rather than invented: the
 * value is configurable, and the route must physically exist before any template that links to
 * it is activated. See the SA1 receipt.
 */
export const AUTH_CONFIRM_PATH = '/auth/confirm';

/**
 * Build the canonical, CarUp-owned action link for an auth Email.
 *
 * Uses Supabase's TokenHash flow rather than {{ .ConfirmationURL }}, because ConfirmationURL
 * resolves to the raw project-ref.supabase.co host — which would make a Supabase infrastructure
 * hostname the durable, forwardable identity in a user's inbox.
 */
export function buildAuthActionUrl({ type, next = '/', env = process.env, confirmPath = AUTH_CONFIRM_PATH } = {}) {
  const origin = resolveCanonicalWebOrigin(env);
  const params = new URLSearchParams({ token_hash: '{{ .TokenHash }}', type });
  if (next) params.set('next', next);
  // URLSearchParams percent-encodes the Supabase placeholder braces; restore them so the
  // template variable is still substitutable by Supabase at send time.
  const query = params.toString().replace(/%7B%7B\+?\.?TokenHash\+?%7D%7D/gi, '{{ .TokenHash }}').replace(/\+/g, '%20');
  return `${origin}${confirmPath}?${query}`;
}

function layout({ preheader, heading, intro, actionLabel, actionUrl, body = '', securityNote, footerNote }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.CANVAS};">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.CANVAS};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="${BRAND.MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${BRAND.MAX_WIDTH}px;background:${BRAND.SURFACE};border:1px solid ${BRAND.BORDER};border-radius:12px;">
<tr><td style="padding:32px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="font-size:20px;font-weight:700;color:${BRAND.INK};letter-spacing:-0.01em;">Car<span style="color:${BRAND.ACTION};">Up</span></div>
</td></tr>
<tr><td style="padding:16px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;color:${BRAND.INK};">${heading}</h1>
<p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:${BRAND.BODY};">${intro}</p>
${body}
</td></tr>
${actionUrl ? `<tr><td style="padding:4px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${BRAND.ACTION};border-radius:8px;">
<a href="${actionUrl}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:${BRAND.ACTION_TEXT};text-decoration:none;">${actionLabel}</a>
</td></tr></table>
<p style="margin:18px 0 0 0;font-size:13px;line-height:1.6;color:${BRAND.MUTED};">If the button does not work, copy and paste this link into your browser:<br>
<span style="color:${BRAND.BODY};word-break:break-all;">${actionUrl}</span></p>
</td></tr>` : ''}
<tr><td style="padding:20px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<p style="margin:0;padding:14px 16px;background:${BRAND.CANVAS};border-radius:8px;font-size:13px;line-height:1.6;color:${BRAND.BODY};">${securityNote}</p>
</td></tr>
<tr><td style="padding:24px 32px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-top:1px solid ${BRAND.BORDER};margin-top:8px;">
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
 * The six authentication templates plus the account-security notifications.
 *
 * `supabaseTemplate` is the Supabase Auth template key. `enabledByDefault:false` marks a
 * notification for a capability CarUp must be confirmed to support before it is switched on
 * (SA1.3: do not enable a security flow the product does not actually support).
 */
export const AUTH_EMAIL_TEMPLATES = Object.freeze({
  confirm_signup: {
    supabaseTemplate: 'Confirm signup',
    category: 'authentication',
    subject: 'Confirm your CarUp account',
    tokenType: 'signup',
    build: (env) => layout({
      preheader: 'Confirm your email address to activate your CarUp account.',
      heading: 'Confirm your email address',
      intro: 'Welcome to CarUp. Confirm this email address to activate your account and secure it against unauthorised access.',
      actionLabel: 'Confirm email address',
      actionUrl: buildAuthActionUrl({ type: 'signup', next: '/', env }),
      securityNote: `This confirmation link can be used once and expires shortly. ${NO_ACTION_EXPECTED}`,
      footerNote: 'You are receiving this because an account was created with this email address on CarUp.',
    }),
  },

  invite_user: {
    supabaseTemplate: 'Invite user',
    category: 'authentication',
    subject: 'You have been invited to CarUp',
    tokenType: 'invite',
    build: (env) => layout({
      preheader: 'Accept your invitation to join CarUp.',
      heading: 'You have been invited to CarUp',
      intro: 'An invitation to join CarUp has been issued for {{ .Email }}. Accept it to set up your account.',
      actionLabel: 'Accept invitation',
      actionUrl: buildAuthActionUrl({ type: 'invite', next: '/', env }),
      securityNote: `This invitation link can be used once and expires shortly. ${NO_ACTION_EXPECTED}`,
      footerNote: 'You are receiving this because your email address was invited to CarUp.',
    }),
  },

  magic_link: {
    supabaseTemplate: 'Magic Link',
    category: 'authentication',
    subject: 'Your CarUp sign-in link',
    tokenType: 'magiclink',
    build: (env) => layout({
      preheader: 'Use this link to sign in to CarUp.',
      heading: 'Sign in to CarUp',
      intro: 'Use the button below to sign in. For your security this link works once and expires shortly.',
      actionLabel: 'Sign in to CarUp',
      actionUrl: buildAuthActionUrl({ type: 'magiclink', next: '/', env }),
      body: `<p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:${BRAND.BODY};">If you prefer to enter a code, use: <strong style="color:${BRAND.INK};letter-spacing:0.08em;">{{ .Token }}</strong></p>`,
      securityNote: `Never share this link or code with anyone. CarUp will never ask you for it. ${NO_ACTION_EXPECTED}`,
      footerNote: 'You are receiving this because a sign-in was requested for this email address.',
    }),
  },

  change_email: {
    supabaseTemplate: 'Change Email Address',
    category: 'authentication',
    subject: 'Confirm your new CarUp email address',
    tokenType: 'email_change',
    build: (env) => layout({
      preheader: 'Confirm the new email address for your CarUp account.',
      heading: 'Confirm your new email address',
      intro: 'A request was made to change the email address on your CarUp account from {{ .Email }} to {{ .NewEmail }}. Confirm to complete the change.',
      actionLabel: 'Confirm new email address',
      actionUrl: buildAuthActionUrl({ type: 'email_change', next: '/', env }),
      securityNote: `Until this is confirmed, your account continues to use its current email address. ${SECURITY_ALERT}`,
      footerNote: 'You are receiving this because an email change was requested on your CarUp account.',
    }),
  },

  reset_password: {
    supabaseTemplate: 'Reset Password',
    category: 'authentication',
    subject: 'Reset your CarUp password',
    tokenType: 'recovery',
    build: (env) => layout({
      preheader: 'Reset the password for your CarUp account.',
      heading: 'Reset your password',
      intro: 'A password reset was requested for your CarUp account. Choose a new password using the button below.',
      actionLabel: 'Reset password',
      actionUrl: buildAuthActionUrl({ type: 'recovery', next: '/', env }),
      securityNote: `This reset link can be used once and expires shortly. Your current password stays active until you choose a new one. ${NO_ACTION_EXPECTED}`,
      footerNote: 'You are receiving this because a password reset was requested for this email address.',
    }),
  },

  reauthentication: {
    supabaseTemplate: 'Reauthentication',
    category: 'authentication',
    subject: 'Your CarUp confirmation code',
    tokenType: 'reauthentication',
    build: () => layout({
      preheader: 'Confirmation code for a sensitive action on your CarUp account.',
      heading: 'Confirm this action',
      intro: 'To continue with a sensitive change on your CarUp account, enter the confirmation code below.',
      body: `<p style="margin:0 0 8px 0;font-size:13px;color:${BRAND.MUTED};">Confirmation code</p>
<p style="margin:0 0 20px 0;font-size:28px;font-weight:700;letter-spacing:0.12em;color:${BRAND.INK};">{{ .Token }}</p>`,
      securityNote: `This code expires shortly and can be used once. Never share it with anyone, including someone claiming to be CarUp support. ${NO_ACTION_EXPECTED}`,
      footerNote: 'You are receiving this because a sensitive action was attempted on your CarUp account.',
    }),
  },
});

/** Account-security notifications. Each must be reconciled against real product capability. */
export const SECURITY_NOTIFICATION_TEMPLATES = Object.freeze({
  password_changed: {
    category: 'security_notification', enabledByDefault: true,
    subject: 'Your CarUp password was changed',
    requiresCapability: 'password change',
    build: () => layout({
      preheader: 'The password on your CarUp account was changed.',
      heading: 'Your password was changed',
      intro: 'The password for your CarUp account was changed. If this was you, no further action is needed.',
      securityNote: SECURITY_ALERT,
      footerNote: 'You are receiving this because of a security change on your CarUp account.',
    }),
  },
  email_changed: {
    category: 'security_notification', enabledByDefault: true,
    subject: 'Your CarUp email address was changed',
    requiresCapability: 'email change',
    build: () => layout({
      preheader: 'The email address on your CarUp account was changed.',
      heading: 'Your email address was changed',
      intro: 'The email address for your CarUp account was changed to {{ .NewEmail }}.',
      securityNote: SECURITY_ALERT,
      footerNote: 'You are receiving this because of a security change on your CarUp account.',
    }),
  },
  phone_changed: {
    category: 'security_notification', enabledByDefault: false,
    subject: 'Your CarUp phone number was changed',
    requiresCapability: 'phone auth (NOT reconciled — CarUp has no phone auth flow)',
    build: () => layout({
      preheader: 'The phone number on your CarUp account was changed.',
      heading: 'Your phone number was changed',
      intro: 'The phone number for your CarUp account was changed.',
      securityNote: SECURITY_ALERT,
      footerNote: 'You are receiving this because of a security change on your CarUp account.',
    }),
  },
  mfa_factor_added: {
    category: 'security_notification', enabledByDefault: false,
    subject: 'A verification method was added to your CarUp account',
    requiresCapability: 'MFA (NOT reconciled — CarUp has no MFA enrolment flow)',
    build: () => layout({
      preheader: 'A verification method was added to your CarUp account.',
      heading: 'A verification method was added',
      intro: 'A new verification method was added to your CarUp account.',
      securityNote: SECURITY_ALERT,
      footerNote: 'You are receiving this because of a security change on your CarUp account.',
    }),
  },
  mfa_factor_removed: {
    category: 'security_notification', enabledByDefault: false,
    subject: 'A verification method was removed from your CarUp account',
    requiresCapability: 'MFA (NOT reconciled — CarUp has no MFA enrolment flow)',
    build: () => layout({
      preheader: 'A verification method was removed from your CarUp account.',
      heading: 'A verification method was removed',
      intro: 'A verification method was removed from your CarUp account.',
      securityNote: SECURITY_ALERT,
      footerNote: 'You are receiving this because of a security change on your CarUp account.',
    }),
  },
});

/** Render one template's HTML. */
export function renderAuthEmail(key, env = process.env) {
  const tpl = AUTH_EMAIL_TEMPLATES[key] || SECURITY_NOTIFICATION_TEMPLATES[key];
  if (!tpl) throw new Error(`Unknown auth email template: ${key}`);
  return { subject: tpl.subject, html: tpl.build(env), category: tpl.category };
}

/** Every template key, authentication templates first. */
export function listAuthEmailTemplateKeys() {
  return [...Object.keys(AUTH_EMAIL_TEMPLATES), ...Object.keys(SECURITY_NOTIFICATION_TEMPLATES)];
}
