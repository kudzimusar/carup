from pathlib import Path
import json


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    p.write_text(text.replace(old, new, 1))


def replace_in_region(path: str, region_start: str, region_end: str, replacements: list[tuple[str, str, str]]) -> None:
    p = Path(path)
    text = p.read_text()
    start = text.index(region_start)
    end = text.index(region_end, start)
    prefix, region, suffix = text[:start], text[start:end], text[end:]
    for old, new, label in replacements:
        count = region.count(old)
        if count != 1:
            raise SystemExit(f"{label}: expected exactly one anchor in region, found {count}")
        region = region.replace(old, new, 1)
    p.write_text(prefix + region + suffix)


# A. Vehicle Detail: the implementation removed the unsupported legacy approval claim entirely.
# Keep the regression proof aligned to that stronger invariant instead of resurrecting the badge.
replace_once(
    'web/src/pages/VehicleDetail.media.test.tsx',
    """  it('does not stamp the Police Checked badge onto the seller’s photo', async () => {
    // The badge is a registry claim about the VEHICLE. Overlaid on the gallery it read as a claim
    // about the picture underneath it, which is the conflation this phase removes. It still renders
    // — it moved to the identity row — so this is a placement assertion, not a deletion.
    servePassport(passportFixture({ evidenceVault: [], policeVerified: true }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('police-checked-badge')).toBeTruthy())

    expect(screen.getByTestId('listing-media-block').innerHTML).not.toContain('Police Checked')
  })
""",
    """  it('publishes no unsupported Police Checked approval claim anywhere on the buyer page', async () => {
    // `police_verified` is a legacy boolean without authoritative public provenance. The hardened
    // buyer contract suppresses the approval claim entirely. A future public approval claim must
    // arrive through a governed evidence/fact contract rather than this compatibility boolean.
    servePassport(passportFixture({ evidenceVault: [], policeVerified: true }))
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('listing-media-block')).toBeTruthy())

    expect(screen.queryByTestId('police-checked-badge')).toBeNull()
    expect(document.body.textContent).not.toContain('Police Checked')
    expect(screen.getByTestId('listing-media-block').innerHTML).not.toContain('Police Checked')
  })
""",
    'VehicleDetail stale Police Checked regression',
)


# B. Web Marketplace: central fail-closed presentation guards for media state and adverse plate state.
Path('web/src/lib/marketplacePresentation.ts').write_text("""const PUBLISHABLE_PRIMARY_IMAGE_STATES = new Set(['seller_primary', 'first_published'])
const ADVERSE_PLATE_STATES = new Set(['flagged', 'suspended'])

export function canRenderMarketplacePrimaryImage(state: unknown, url: unknown): url is string {
  return typeof url === 'string'
    && url.trim() !== ''
    && typeof state === 'string'
    && PUBLISHABLE_PRIMARY_IMAGE_STATES.has(state)
}

export function primaryImageForListing(listing: {
  primary_image_state?: unknown
  primary_image_url?: unknown
}): string | null {
  return canRenderMarketplacePrimaryImage(listing.primary_image_state, listing.primary_image_url)
    ? listing.primary_image_url.trim()
    : null
}

export function isAdversePlateStatus(status: unknown): boolean {
  return typeof status === 'string' && ADVERSE_PLATE_STATES.has(status.trim().toLowerCase())
}

export function plateStatusLabel(listing: { plate_status?: unknown; plate_verified?: unknown }): string {
  const status = typeof listing.plate_status === 'string' ? listing.plate_status.trim() : ''
  const normalized = status.toLowerCase()
  if (normalized === 'flagged') return 'Plate flagged'
  if (normalized === 'suspended') return 'Plate suspended'
  if (listing.plate_verified === true) return 'Plate confirmed'
  if (status) return `Plate ${status.replace(/[_-]+/g, ' ').toLowerCase()}`
  return 'Plate status unknown'
}
""")

Path('web/src/lib/marketplacePresentation.test.ts').write_text("""import { describe, expect, it } from 'vitest'
import {
  canRenderMarketplacePrimaryImage,
  isAdversePlateStatus,
  plateStatusLabel,
  primaryImageForListing,
} from './marketplacePresentation'

describe('marketplace buyer presentation guards', () => {
  it('fails closed when a URL disagrees with the canonical primary-image state', () => {
    expect(primaryImageForListing({ primary_image_state: 'none', primary_image_url: 'https://cdn.test/leak.jpg' })).toBeNull()
    expect(primaryImageForListing({ primary_image_state: 'not_loaded', primary_image_url: '/stale.jpg' })).toBeNull()
    expect(primaryImageForListing({ primary_image_state: 'seller_primary', primary_image_url: '/good.jpg' })).toBe('/good.jpg')
    expect(canRenderMarketplacePrimaryImage('first_published', 'https://cdn.test/good.jpg')).toBe(true)
  })

  it('gives adverse plate lifecycle state priority over a positive verification boolean', () => {
    expect(isAdversePlateStatus('Flagged')).toBe(true)
    expect(isAdversePlateStatus('Suspended')).toBe(true)
    expect(plateStatusLabel({ plate_status: 'Flagged', plate_verified: true })).toBe('Plate flagged')
    expect(plateStatusLabel({ plate_status: 'Suspended', plate_verified: true })).toBe('Plate suspended')
    expect(plateStatusLabel({ plate_status: 'Active', plate_verified: true })).toBe('Plate confirmed')
    expect(plateStatusLabel({ plate_status: 'Active', plate_verified: false })).toBe('Plate active')
  })
})
""")

replace_once(
    'web/src/pages/Marketplace.tsx',
    "import type { ActiveFilterKey, MarketplaceSort, MarketplaceUrlState } from '@/lib/marketplaceParams'\n",
    "import type { ActiveFilterKey, MarketplaceSort, MarketplaceUrlState } from '@/lib/marketplaceParams'\nimport { isAdversePlateStatus, plateStatusLabel, primaryImageForListing } from '@/lib/marketplacePresentation'\n",
    'Marketplace presentation import',
)
replace_once(
    'web/src/pages/Marketplace.tsx',
    """function plateStatusLabel(listing: MarketplaceListingSummary) {
  if (listing.plate_verified) return 'Plate confirmed'
  if (listing.plate_status?.trim()) return 'Plate on file'
  return 'Plate status unknown'
}

""",
    '',
    'Marketplace local plate label',
)
replace_once(
    'web/src/pages/Marketplace.tsx',
    '                    primaryImage: listing.primary_image_url || null,\n',
    '                    primaryImage: primaryImageForListing(listing),\n',
    'Marketplace primary image adapter',
)
replace_once(
    'web/src/pages/Marketplace.tsx',
    '                    plateVerified: listing.plate_verified,\n',
    '                    plateVerified: listing.plate_verified === true && !isAdversePlateStatus(listing.plate_status),\n',
    'Marketplace adverse plate badge guard',
)

replace_once(
    'web/src/components/marketplace/MarketplaceListingCard.tsx',
    "import { ListingImage } from '@/components/marketplace/ListingImage'\n",
    "import { ListingImage } from '@/components/marketplace/ListingImage'\nimport { canRenderMarketplacePrimaryImage } from '@/lib/marketplacePresentation'\n",
    'card image guard import',
)
replace_once(
    'web/src/components/marketplace/MarketplaceListingCard.tsx',
    """}: MarketplaceListingCardProps) {
  return (
""",
    """}: MarketplaceListingCardProps) {
  const renderablePrimaryImage = canRenderMarketplacePrimaryImage(vehicle.primaryImageState, vehicle.primaryImage)
    ? vehicle.primaryImage
    : null

  return (
""",
    'card renderable image guard',
)
replace_once(
    'web/src/components/marketplace/MarketplaceListingCard.tsx',
    '            src={vehicle.primaryImage}\n',
    '            src={renderablePrimaryImage}\n',
    'card guarded image source',
)


# C. Shared listing contract: modify only MarketplaceListingSummary, never the separate Vehicle model.
replace_in_region(
    'shared/types/index.ts',
    'export interface MarketplaceListingSummary {',
    'export interface MarketplaceListingsResponse {',
    [
        ('  year: number;\n', '  year: number | null;\n', 'Marketplace year nullability'),
        ('  price: number;\n', '  price: number | null;\n', 'Marketplace price nullability'),
        ('  currency: string;\n', '  currency: string | null;\n', 'Marketplace currency nullability'),
        ('  mileage: number;\n', '  mileage: number | null;\n', 'Marketplace mileage nullability'),
        ("  seller_type: 'dealer' | 'private' | string;\n", "  seller_type: 'dealer' | 'private' | string | null;\n", 'Marketplace seller type nullability'),
        ('  seller_display_label: string;\n', '  seller_display_label: string | null;\n', 'Marketplace seller label nullability'),
        ('  location?: string;\n', '  location?: string | null;\n', 'Marketplace location nullability'),
    ],
)


# D. Native: bind Trust to the shared canonical contract and resolve web-style media URLs safely.
replace_once(
    'mobile/utils/marketplaceApi.ts',
    "import { getVerificationApiBaseUrl, fetchCsrfToken } from './verificationApi';\n",
    """import { getVerificationApiBaseUrl, fetchCsrfToken } from './verificationApi';
import type {
  MarketplacePublicTrust,
  MarketplaceTrustEvaluationState,
  MarketplaceTrustEvidenceBasis,
} from '@shared/types';
""",
    'mobile shared Trust import',
)

p = Path('mobile/utils/marketplaceApi.ts')
m = p.read_text()
start = m.index('/**\n * Exact public trust projection published by canonicalTrustService.toPublicTrust().')
end = m.index('export interface MobileTransactionIntent', start)
m = m[:start] + """/** Shared aliases bind native rendering to the same ten-field public Trust contract as web. */
export type MobileTrustEvaluationState = MarketplaceTrustEvaluationState;
export type MobileTrustEvidenceBasis = MarketplaceTrustEvidenceBasis;
export type MobilePublicTrust = MarketplacePublicTrust;

""" + m[end:]

media_anchor = """export type MobilePrimaryImageState = 'seller_primary' | 'first_published' | 'none' | 'not_loaded';
export type MobileReservationState = 'active' | 'expired' | 'none' | 'unavailable' | 'inconsistent';

"""
if m.count(media_anchor) != 1:
    raise SystemExit(f'mobile media helper anchor: expected one, found {m.count(media_anchor)}')
media_helpers = media_anchor + """const PUBLISHABLE_PRIMARY_IMAGE_STATES = new Set<MobilePrimaryImageState>(['seller_primary', 'first_published']);

function inferMediaUrlForm(url: string): MobileMediaUrlForm | null {
  if (url.startsWith('//')) return 'protocol_relative';
  if (url.startsWith('/')) return 'site_relative';
  if (/^https:\/\//i.test(url)) return 'absolute_https';
  if (/^http:\/\//i.test(url)) return 'absolute_http';
  return null;
}

export function resolveMarketplaceMediaUrl(
  url: string | null | undefined,
  expectedForm: MobileMediaUrlForm | null = null,
  baseUrl: string = getVerificationApiBaseUrl(),
): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();
  const inferred = inferMediaUrlForm(trimmed);
  if (!inferred || (expectedForm && expectedForm !== inferred)) return null;
  if (inferred === 'absolute_https' || inferred === 'absolute_http') return trimmed;
  try {
    const base = new URL(baseUrl);
    return new URL(trimmed, base.origin).toString();
  } catch {
    return null;
  }
}

export function resolveMarketplacePrimaryImage(
  listing: { primary_image_state: MobilePrimaryImageState; primary_image_url?: string | null },
  baseUrl: string = getVerificationApiBaseUrl(),
): string | null {
  if (!PUBLISHABLE_PRIMARY_IMAGE_STATES.has(listing.primary_image_state)) return null;
  return resolveMarketplaceMediaUrl(listing.primary_image_url, null, baseUrl);
}

"""
m = m.replace(media_anchor, media_helpers, 1)
p.write_text(m)

replace_once(
    'mobile/app/(tabs)/marketplace.tsx',
    """  getMarketplaceListings,
  type MobileListingSummary,
  type MobilePublicTrust,
""",
    """  getMarketplaceListings,
  resolveMarketplacePrimaryImage,
  type MobileListingSummary,
  type MobilePublicTrust,
""",
    'mobile list resolver import',
)
replace_once(
    'mobile/app/(tabs)/marketplace.tsx',
    """    const isReserved = item.reservation_summary?.reserved === true;

    return (
""",
    """    const isReserved = item.reservation_summary?.reserved === true;
    const primaryImageUrl = resolveMarketplacePrimaryImage(item);

    return (
""",
    'mobile list primary image variable',
)
replace_once(
    'mobile/app/(tabs)/marketplace.tsx',
    """            {item.primary_image_url ? (
              <Image
                source={{ uri: item.primary_image_url }}
""",
    """            {primaryImageUrl ? (
              <Image
                source={{ uri: primaryImageUrl }}
""",
    'mobile list guarded image source',
)

replace_once(
    'mobile/app/vehicle/[vin].tsx',
    """  getMarketplaceListingDetail,
  createMarketplaceInquiry,
  type MobileListingDetail,
""",
    """  getMarketplaceListingDetail,
  createMarketplaceInquiry,
  resolveMarketplacePrimaryImage,
  type MobileListingDetail,
""",
    'mobile detail resolver import',
)
replace_once(
    'mobile/app/vehicle/[vin].tsx',
    """function formatMileage(mileage: number | null) {
  return typeof mileage === 'number' && Number.isFinite(mileage)
    ? `${mileage.toLocaleString()} km`
    : 'Mileage not recorded';
}

""",
    """function formatMileage(mileage: number | null) {
  return typeof mileage === 'number' && Number.isFinite(mileage)
    ? `${mileage.toLocaleString()} km`
    : 'Mileage not recorded';
}

function formatEvaluationDate(value: string | null | undefined) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString() : null;
}

""",
    'mobile evaluated date helper',
)
replace_once(
    'mobile/app/vehicle/[vin].tsx',
    """function TrustCard({ trust }: { trust?: MobilePublicTrust | null }) {
  const evaluatedScore = trust?.evaluation_state === 'evaluated'
""",
    """function TrustCard({ trust }: { trust?: MobilePublicTrust | null }) {
  const evaluatedDate = formatEvaluationDate(trust?.evaluated_at);
  const evaluatedScore = trust?.evaluation_state === 'evaluated'
""",
    'mobile evaluated date binding',
)
replace_once(
    'mobile/app/vehicle/[vin].tsx',
    """        {trust?.evaluated_at ? (
          <Text className="mt-3 text-[10px] text-slate-500">Evaluated {new Date(trust.evaluated_at).toLocaleDateString()}</Text>
        ) : null}
""",
    """        {evaluatedDate ? (
          <Text className="mt-3 text-[10px] text-slate-500">Evaluated {evaluatedDate}</Text>
        ) : null}
""",
    'mobile safe evaluated date render',
)
replace_once(
    'mobile/app/vehicle/[vin].tsx',
    """  const mediaItem = vehicle.listing_media?.items?.[0] || null;
  const heroUrl = mediaItem?.url || vehicle.primary_image_url || null;
""",
    """  // The backend has already elected the canonical primary. Re-electing items[0] here can
  // contradict the seller's is_primary choice and bypass primary_image_state on inconsistent payloads.
  const heroUrl = resolveMarketplacePrimaryImage(vehicle);
""",
    'mobile detail canonical hero',
)

Path('mobile/tests/marketplace-media-contract.test.ts').write_text("""import assert from 'node:assert/strict';
import {
  resolveMarketplaceMediaUrl,
  resolveMarketplacePrimaryImage,
} from '../utils/marketplaceApi';

const base = 'https://api.carup.dev/api';

assert.equal(
  resolveMarketplaceMediaUrl('/uat/owner/hilux.svg', 'site_relative', base),
  'https://api.carup.dev/uat/owner/hilux.svg',
);
assert.equal(
  resolveMarketplaceMediaUrl('//cdn.carup.dev/hilux.jpg', 'protocol_relative', base),
  'https://cdn.carup.dev/hilux.jpg',
);
assert.equal(resolveMarketplaceMediaUrl('data:image/png;base64,AAAA', null, base), null);
assert.equal(resolveMarketplaceMediaUrl('/good.jpg', 'absolute_https', base), null);
assert.equal(
  resolveMarketplacePrimaryImage({ primary_image_state: 'none', primary_image_url: '/stale.jpg' }, base),
  null,
);
assert.equal(
  resolveMarketplacePrimaryImage({ primary_image_state: 'seller_primary', primary_image_url: '/good.jpg' }, base),
  'https://api.carup.dev/good.jpg',
);

console.log('marketplace media contract: PASS');
""")

package_path = Path('mobile/package.json')
package = json.loads(package_path.read_text())
addition = 'tsx tests/marketplace-media-contract.test.ts'
native_script = package['scripts']['test:native']
if addition not in native_script:
    package['scripts']['test:native'] = native_script + ' && ' + addition
package_path.write_text(json.dumps(package, indent=2) + '\n')


# E. Browser reference regression: cover omitted lifecycle/error states and verify facet forwarding.
e2e = Path('web/e2e/marketplace-reference-ux.spec.ts')
et = e2e.read_text()
if "test('stale/unavailable trust, missing price, media-state mismatch and adverse plate status fail closed'" not in et:
    et += """

test('stale/unavailable trust, missing price, media-state mismatch and adverse plate status fail closed', async ({ page }) => {
  await commonMocks(page)
  await page.route(/\\/api\\/marketplace\\/listings(\\?|$)/, (route: Route) => route.fulfill({
    json: {
      total: 2,
      limit: 48,
      listings: [
        listing(VIN_A, {
          price: null,
          currency: null,
          trust_score: 99,
          trust: { score: null, band: null, evaluation_state: 'stale', confidence: 'low', calculation_version: 'old', known_limitations: [] },
          primary_image_url: 'https://cdn.carup.dev/should-not-render.jpg',
          primary_image_state: 'not_loaded',
          plate_verified: true,
          plate_status: 'Flagged',
        }),
        listing(VIN_B, {
          make: 'Honda', model: 'Fit', trust_score: 97,
          trust: { score: null, band: null, evaluation_state: 'unavailable', confidence: 'not_evaluated', calculation_version: null, known_limitations: [] },
        }),
      ],
    },
  }))

  await page.goto('/marketplace')
  const cards = page.getByTestId('marketplace-vehicle-card')
  const first = cards.nth(0)
  const second = cards.nth(1)
  await expect(first.getByTestId('marketplace-card-price')).toContainText('Price not recorded')
  await expect(first.getByTestId('marketplace-card-trust')).toContainText('Evaluation update pending')
  await expect(second.getByTestId('marketplace-card-trust')).toContainText('Trust temporarily unavailable')
  await expect(first).not.toContainText('99')
  await expect(second).not.toContainText('97')
  await expect(first.locator('img[src*="should-not-render"]')).toHaveCount(0)
  await expect(first.getByTestId('marketplace-plate-status')).toHaveText('Plate flagged')
  await expect(first.getByTestId('marketplace-plate-confirmed-badge')).toHaveCount(0)
})

test('location, fuel and transmission facets are forwarded to the canonical backend', async ({ page }) => {
  await commonMocks(page)
  const observed: string[] = []
  await page.route(/\\/api\\/marketplace\\/listings(\\?|$)/, (route: Route) => {
    const url = new URL(route.request().url())
    observed.push(url.search)
    return route.fulfill({ json: { total: 1, limit: 48, listings: [listing(VIN_A)] } })
  })

  await page.goto('/marketplace?location=Harare&fuel=Diesel&transmission=Automatic')
  await expect(page.getByTestId('marketplace-vehicle-card').first()).toBeVisible()
  await expect.poll(() => observed.some(search => {
    const params = new URLSearchParams(search)
    return params.get('location') === 'Harare'
      && params.get('fuel') === 'Diesel'
      && params.get('transmission') === 'Automatic'
  })).toBe(true)
})
"""
e2e.write_text(et)


# F. Self-clean. Neither the temporary workflow nor this patch script belongs in the feature tree.
Path('.github/workflows/marketplace-hardening-one-off.yml').unlink(missing_ok=True)
Path('.github/scripts/marketplace-continuity-hardening.py').unlink(missing_ok=True)
