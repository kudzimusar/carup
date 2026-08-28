/**
 * Which CarUp identity a family is sent AS.
 *
 * Maps classification onto the sending identities that already exist. It introduces no new sending
 * domain and mints no new address: the personas below resolve from the same env the adapters read,
 * and the fallbacks are the values already shipped in `env.example` and the adapters themselves.
 *
 * The staff aliases (`kudzie@`, `king@`, `questions@`) are INBOUND-CERTIFIED ONLY —
 * `OUTBOUND_SENDING_CONFIGURED=NO` — so none of them may ever appear as a `From` identity. Leadership
 * Email replies to `info@carup.dev`, which is a reply-to, not a sender.
 */
const envValue = (env, key) => {
  const value = env?.[key];
  return value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim();
};

/**
 * Persona per classification.
 *
 * `security` uses the dedicated security sender the Resend adapter already selects for auth Email,
 * so a password reset keeps arriving from the identity a customer has been taught to expect.
 */
const PERSONAS = Object.freeze({
  security: {
    key: 'carup_security',
    name: 'CarUp Security',
    addressEnv: 'RESEND_AUTH_FROM_EMAIL',
    fallback: 'auth@mail.carup.dev',
    replyTo: null,               // security Email is not a conversation
    signOff: 'This is an automated security message. Please do not reply.',
  },
  transactional: {
    key: 'carup_notifications', name: 'CarUp', addressEnv: 'RESEND_FROM_EMAIL',
    fallback: 'notifications@mail.carup.dev', replyTo: null, signOff: null,
  },
  conversational: {
    key: 'carup_conversations', name: 'CarUp', addressEnv: 'RESEND_FROM_EMAIL',
    fallback: 'notifications@mail.carup.dev',
    // A conversational Email is a human thread; a reply must be able to come back to it. The actual
    // reply address is minted per-thread by G5, so this stays null until then rather than
    // advertising an address that routes nowhere.
    replyTo: null, signOff: null,
  },
  service: {
    key: 'carup_service', name: 'CarUp', addressEnv: 'RESEND_FROM_EMAIL',
    fallback: 'notifications@mail.carup.dev', replyTo: null, signOff: null,
  },
  marketing: {
    key: 'carup_weekly', name: 'CarUp', addressEnv: 'BREVO_FROM_EMAIL',
    fallback: 'news@marketing.carup.dev', replyTo: null, signOff: null,
  },
});

/**
 * Resolve the persona for a classification.
 *
 * Returns descriptive metadata only. The adapter still builds the actual `From` header from its own
 * env — G2 does not move sender selection into the renderer, because that would make the renderer a
 * transport component, which is the direction G3 spent its effort travelling away from.
 */
export function senderPersonaFor(classification, env = process.env) {
  const persona = PERSONAS[classification];
  if (!persona) return null;
  return Object.freeze({
    key: persona.key,
    name: persona.name,
    address: envValue(env, persona.addressEnv) || persona.fallback,
    replyTo: persona.replyTo,
    signOff: persona.signOff,
  });
}

export function listSenderPersonaKeys() {
  return Object.values(PERSONAS).map((p) => p.key);
}

export default senderPersonaFor;
