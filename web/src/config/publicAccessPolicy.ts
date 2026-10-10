/**
 * CarUp's guest-access policy — PC01-J-R1 §5. One authoritative statement of what a visitor without
 * an account may do on each public surface, and the exact point at which CarUp asks for one.
 *
 * The rule: browse first. An account is asked for at the point of persisting private data,
 * submitting authority evidence, publishing, messaging, reserving or paying, managing an
 * organisation, or changing an account-owned record — never merely to look.
 *
 * `publicAccessPolicy.test.ts` holds the router to this declaration (every PUBLIC and
 * PUBLIC_READ_AUTH_ACTION route renders for a guest; every AUTH_REQUIRED / ROLE_REQUIRED route sends a
 * guest to Sign In with the destination preserved; every PLANNED route renders its planned state).
 */
export type AccessClass = 'PUBLIC' | 'PUBLIC_READ_AUTH_ACTION' | 'AUTH_REQUIRED' | 'ROLE_REQUIRED' | 'PLANNED'

export interface SurfaceAccessPolicy {
  surface: string
  routes: readonly string[]
  access: AccessClass
  /** What a guest can do there without an account. */
  guestCan: readonly string[]
  /** The actions at which an account is asked for. */
  accountAskedAt: readonly string[]
  /** A recorded deviation from the rule, with its authority. */
  deviation?: string
}

export const PUBLIC_ACCESS_POLICY: ReadonlyArray<SurfaceAccessPolicy> = Object.freeze([
  {
    surface: 'Home', routes: ['/'], access: 'PUBLIC',
    guestCan: ['read the home page', 'search the Marketplace', 'start a VIN lookup', 'start selling in the browser'],
    accountAskedAt: [],
  },
  {
    surface: 'Marketplace', routes: ['/marketplace'], access: 'PUBLIC_READ_AUTH_ACTION',
    guestCan: ['browse, search and filter published listings', 'compare up to four listings', 'keep favourites in this browser'],
    accountAskedAt: ['saving a listing to an account'],
  },
  {
    surface: 'Vehicle details', routes: ['/marketplace/:id', '/marketplace/listing/:id'], access: 'PUBLIC_READ_AUTH_ACTION',
    guestCan: ['read a published listing', 'read its public Vehicle Passport and canonical Trust state'],
    accountAskedAt: ['saving to an account', 'seeing what the Trust position is based on and which sources were checked', 'generating or sharing a report'],
    deviation: 'A purchase-interest or inspection inquiry is accepted from a guest who leaves an email or phone number (marketplaceInquiryService, by product design). The J-R1 rule asks for an account at messaging; changing that is a product decision recorded for the owner, not made here.',
  },
  {
    surface: 'Vehicle Passport', routes: ['/marketplace/:id'], access: 'PUBLIC_READ_AUTH_ACTION',
    guestCan: ['an exact 17-character VIN lookup', 'the Passport of a publicly listed vehicle'],
    accountAskedAt: ['a plate, chassis/frame-number or temporary-identifier lookup', 'the Passport of a vehicle that is not publicly listed'],
  },
  {
    surface: 'Verify', routes: ['/search'], access: 'PUBLIC_READ_AUTH_ACTION',
    guestCan: ['search published listings', 'an exact 17-character VIN lookup'],
    accountAskedAt: ['a plate, chassis/frame-number or temporary-identifier lookup'],
  },
  {
    surface: 'Dealers', routes: ['/dealers'], access: 'PUBLIC_READ_AUTH_ACTION',
    guestCan: ['read the verified-dealer directory', 'read how a dealership joins'],
    accountAskedAt: ['applying as a dealer (organisation onboarding)'],
  },
  {
    surface: 'Garages / Services', routes: ['/garages', '/garages/:slug', '/marketplace/services'], access: 'PUBLIC_READ_AUTH_ACTION',
    guestCan: ['read published garage profiles', 'read how a garage joins'],
    accountAskedAt: ['requesting service from a garage', 'registering a garage (organisation onboarding)'],
  },
  {
    surface: 'Parts', routes: ['/marketplace/parts'], access: 'PUBLIC_READ_AUTH_ACTION',
    guestCan: ['read the parts surface and fitment search'],
    accountAskedAt: [],
    deviation: 'A parts-quote request is accepted from a guest who leaves an email or phone number (the same marketplace inquiry path as above).',
  },
  {
    surface: 'Trust & Safety', routes: ['/trust'], access: 'PUBLIC',
    guestCan: ['read the safety guides', 'find the email address for reporting'],
    accountAskedAt: [],
  },
  {
    surface: 'Help', routes: ['/help', '/support', '/security'], access: 'PUBLIC',
    guestCan: ['read help, support and security guidance'],
    accountAskedAt: [],
  },
  {
    surface: 'Contact', routes: ['/contact'], access: 'PUBLIC',
    guestCan: ['see every contact address by purpose', 'see which channels CarUp does not offer'],
    accountAskedAt: ['messaging a seller about a listing'],
  },
  {
    surface: 'Pricing', routes: ['/pricing'], access: 'PUBLIC',
    guestCan: ['read that no prices are published yet'],
    accountAskedAt: [],
  },
  {
    surface: 'Diaspora info', routes: ['/diaspora'], access: 'PUBLIC_READ_AUTH_ACTION',
    guestCan: ['read how importing through CarUp works'],
    accountAskedAt: ['starting or viewing an import order'],
  },
  {
    surface: 'Sell entry', routes: ['/sell'], access: 'PUBLIC_READ_AUTH_ACTION',
    guestCan: ['draft a listing — vehicle, photos, price — in this browser'],
    accountAskedAt: ['saving the draft to an account', 'publishing'],
  },
  // The private destinations behind the public surfaces, so the policy states where it stops.
  {
    surface: 'Seller workspace', routes: ['/dashboard/sell-vehicle', '/dashboard/listings', '/dashboard/garage'], access: 'AUTH_REQUIRED',
    guestCan: [], accountAskedAt: ['opening the workspace'],
  },
  {
    surface: 'Import orders (Trade OS)', routes: ['/diaspora/imports', '/diaspora/imports/new'], access: 'ROLE_REQUIRED',
    guestCan: [], accountAskedAt: ['opening the workspace'],
  },
  {
    surface: 'API documentation', routes: ['/api-docs'], access: 'PLANNED',
    guestCan: [], accountAskedAt: [],
  },
] as const)
