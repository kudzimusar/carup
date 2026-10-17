/**
 * Service Link — what a scanned link MEANS to the person holding the phone (R8).
 *
 * Owner UAT: the backend resolves `/api/service-links/:publicToken` correctly and refuses correctly,
 * but the web app had no `/s/:token` route at all — every QR code in the product landed on the
 * 404 page. A link that cannot be opened is not a link.
 *
 * Security is NOT redesigned here. The resolver decides everything; this module only says what its
 * answer means in plain language. In particular:
 *   - a stranger scanning a windscreen sticker gets `limited` and no VIN, and this file must never
 *     invent one;
 *   - revoked, expired and never-existed are one indistinguishable answer from the resolver, and
 *     stay one answer here — telling them apart would turn the page into an oracle;
 *   - `authentication_required` is a SAFE state, not an error: the link is real, and signing in is
 *     the next step.
 *
 * The words "capability", "grant", "token", "resource" and "redemption" are deliberately absent from
 * everything a person reads. They are correct engineering names for what the backend does, and they
 * are not what a driver in a garage forecourt understands.
 */

export type LinkAccess =
  | 'authentication_required'
  | 'owner'
  | 'limited'
  | 'participant'
  | 'not_a_participant'
  | 'public_practitioner'

export type ResolvedLink = {
  resource_type: 'vehicle' | 'service_case' | 'practitioner' | string
  access: LinkAccess | string
  next_action?: string | null
  authenticated?: boolean
  source_channel?: string | null
  vin?: string | null
  service_case_id?: string | null
  status?: string | null
  practitioner?: {
    affiliation?: { display_name: string; slug: string } | null
    credential_review_state?: string | null
  } | null
}

export type LinkPresentation = {
  /** What this link is, in the words of the person holding the phone. */
  title: string
  /** What they can do about it — never a restatement of the title. */
  body: string
  /** The one action worth offering, or null when there is honestly nothing to do. */
  action: { label: string; to: string } | null
  /** `safe` = the link is real and something can be done. `blocked` = real, but not by you. */
  tone: 'safe' | 'blocked'
}

/** The one thing a person needs from an unopenable link: it is not their fault, and what to do. */
export const INVALID_LINK: LinkPresentation = {
  title: 'This link is not valid',
  body:
    'It may have been withdrawn by whoever created it, or it may never have been a CarUp link. '
    + 'If someone gave you this code, ask them for a new one.',
  action: { label: 'Go to CarUp', to: '/' },
  tone: 'blocked',
}

/** A read that failed is a failure — never reported as an invalid link. */
export const UNREADABLE_LINK: LinkPresentation = {
  title: 'This link could not be checked',
  body:
    'CarUp could not reach the service that verifies links. This is a connection problem, not a '
    + 'statement that your link is invalid. Try again in a moment.',
  action: null,
  tone: 'blocked',
}

/**
 * Where a signed-in participant should land.
 *
 * A Service Case has two sides and they are different products: the person who asked for the work
 * belongs in their own requests, and the garage belongs in its queue. Sending both to one screen
 * would be the same mistake the owner-dashboard-for-garage-staff finding described.
 */
function caseDestination(viewerIsGarageMember: boolean, caseId: string | null | undefined): string {
  if (viewerIsGarageMember) return caseId ? `/garage/cases/${caseId}` : '/garage'
  return '/dashboard/service-requests'
}

export function presentLink(
  link: ResolvedLink,
  options: { returnTo: string; viewerIsGarageMember?: boolean } = { returnTo: '/' },
): LinkPresentation {
  const garageMember = Boolean(options.viewerIsGarageMember)

  if (link.access === 'authentication_required') {
    return {
      title: 'This is a real CarUp link',
      body:
        'Sign in to see what it is for. CarUp does not show vehicle or service details to anyone '
        + 'who has not signed in, even when they are holding the code.',
      action: { label: 'Sign in to continue', to: `/login?returnTo=${encodeURIComponent(options.returnTo)}` },
      tone: 'safe',
    }
  }

  if (link.resource_type === 'vehicle') {
    if (link.access === 'owner' && link.vin) {
      return {
        title: 'Your vehicle',
        body: `This code belongs to ${link.vin}.`,
        action: { label: 'Open this vehicle', to: `/dashboard/garage/${encodeURIComponent(link.vin)}` },
        tone: 'safe',
      }
    }
    // `limited`: a real vehicle, but not this person's. The resolver withheld the VIN and so does
    // this page — the honest thing to offer is the thing a stranger may legitimately do.
    return {
      title: 'This code belongs to a vehicle on CarUp',
      body:
        'It is not one of your vehicles, so its details stay private. If you are a garage and this '
        + 'car is in front of you, ask the owner to send you a service request.',
      action: { label: 'Find a garage', to: '/garages' },
      tone: 'blocked',
    }
  }

  if (link.resource_type === 'service_case') {
    if (link.access === 'participant') {
      return {
        title: 'This is a service job on CarUp',
        body: garageMember
          ? 'You are one of the people working on it. Open it to see where it stands.'
          : 'You asked for this work. Open it to see where it stands.',
        action: { label: 'Open this job', to: caseDestination(garageMember, link.service_case_id) },
        tone: 'safe',
      }
    }
    return {
      title: 'This service job is not yours to open',
      body:
        'CarUp shows a job only to the person who asked for it and the garage doing the work — not '
        + 'even its status. If you should have access, ask whoever gave you this code to add you.',
      action: null,
      tone: 'blocked',
    }
  }

  if (link.resource_type === 'practitioner') {
    const affiliation = link.practitioner?.affiliation
    return {
      title: 'This code belongs to a mechanic on CarUp',
      body: affiliation
        ? `They work at ${affiliation.display_name}. CarUp has not reviewed their qualifications, `
          + 'so this is a record of where they work and nothing more.'
        : 'CarUp has not reviewed their qualifications and their workplace is not published here, so '
          + 'this code confirms only that the person is on CarUp.',
      action: affiliation
        ? { label: `See ${affiliation.display_name}`, to: `/garages/${affiliation.slug}` }
        : null,
      tone: 'safe',
    }
  }

  // An unrecognised resource type is a real link this build does not know how to open. Saying so is
  // more honest than pretending it is invalid.
  return {
    title: 'This link cannot be opened here',
    body: 'It is a valid CarUp link, but this version of CarUp does not know how to show it.',
    action: { label: 'Go to CarUp', to: '/' },
    tone: 'blocked',
  }
}
