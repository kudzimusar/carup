/**
 * CarUp's public identity on the website — PC01-J-R1.
 *
 * Not a new identity scheme: these are the owner-frozen values Email already renders
 * (backend/services/communication/emailExperience/emailBrandIdentity.js, owner gates B1/B2/B3) and
 * the owner-approved purpose → contact mapping
 * (docs/communications/EMAIL_EXPERIENCE_1_0_CONTACT_IDENTITY_MAPPING.md). Before this module the
 * site published a Harare telephone number, a `@carup.co.zw` address on a domain CarUp does not
 * use, invented opening hours and "CarUp Zimbabwe" as the company — each one a claim nobody
 * approved. `publicIdentity.test.ts` holds the website and Email to the same values.
 *
 * Empty is a value. No telephone number, street address, opening hours or social profile is
 * approved, so none exists here, and a surface that wants one must say in words that there is none.
 */

export const PUBLIC_IDENTITY = Object.freeze({
  productName: 'CarUp',
  legalEntity: 'CarUp Technologies',
  descriptor: 'Automotive Intelligence & Trust Network',
  tagline: 'Know the car. Trust the journey.',
  headquarters: 'Tokyo, Japan',
  regionalOffice: 'Harare, Zimbabwe',
  canonicalDomain: 'carup.dev',
})

/** The seven certified functional aliases plus the inbound-certified shared questions alias. */
export const PUBLIC_CONTACTS = Object.freeze({
  support: 'support@carup.dev',
  security: 'security@carup.dev',
  privacy: 'privacy@carup.dev',
  dpo: 'dpo@carup.dev',
  legal: 'legal@carup.dev',
  info: 'info@carup.dev',
  press: 'press@carup.dev',
  questions: 'questions@carup.dev',
})

export type PublicContactPurpose = keyof typeof PUBLIC_CONTACTS

/** "HQ: Tokyo, Japan · Regional office: Harare, Zimbabwe" — the approved location, never a street. */
export const PUBLIC_LOCATION_LINE = `HQ: ${PUBLIC_IDENTITY.headquarters} · Regional office: ${PUBLIC_IDENTITY.regionalOffice}`

/**
 * Contact purposes in the order a visitor most often needs them. The wording of each purpose follows
 * the mapping's §4 ("Purpose → contact resolution"); `questions@` says plainly that it does not
 * replace Support, exactly as the staff-alias freeze requires.
 */
export const CONTACT_PURPOSES: ReadonlyArray<{ purpose: PublicContactPurpose; title: string; detail: string }> = Object.freeze([
  { purpose: 'support', title: 'Help with your account, a listing, a vehicle record or an order', detail: 'Include the email address on your account and a listing link or order reference — never your password.' },
  { purpose: 'security', title: 'A security concern or a suspicious message claiming to be CarUp', detail: 'Do not act on the message. Forward it, with what made you suspicious.' },
  { purpose: 'privacy', title: 'A request about your personal data', detail: 'Access, correction or deletion of the personal data CarUp holds about you.' },
  { purpose: 'dpo', title: 'Data protection questions for CarUp’s data protection contact', detail: 'For data-protection matters that are not a routine privacy request.' },
  { purpose: 'legal', title: 'Legal questions about CarUp’s terms', detail: 'Questions about the Terms of Service or another legal matter.' },
  { purpose: 'press', title: 'Media and press enquiries', detail: 'Editorial and media questions. This is not a customer help address.' },
  { purpose: 'questions', title: 'General and business questions', detail: 'A shared CarUp team address. It does not replace Support — account and order problems are handled faster there.' },
  { purpose: 'info', title: 'Anything else about CarUp', detail: 'General correspondence with CarUp.' },
])
