from pathlib import Path

root = Path('candidate')
api = root / 'mobile/utils/marketplaceApi.ts'
text = api.read_text()
old = """export function resolveMarketplaceMediaUrl(
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
new = """export function resolveMarketplaceMediaUrl(
  url: string | null | undefined,
  expectedForm: MobileMediaUrlForm | null = null,
  schemeSourceUrl?: string,
): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();
  const inferred = inferMediaUrlForm(trimmed);
  if (!inferred || (expectedForm && expectedForm !== inferred)) return null;

  // Absolute media is already self-resolving and must not depend on API configuration.
  if (inferred === 'absolute_https' || inferred === 'absolute_http') return trimmed;

  // A single-leading-slash URL is defined by the canonical media contract as relative to the
  // VIEWING origin. Native has no viewing origin. Resolving it against the API host invents an
  // origin the backend never asserted (and staging proves that host returns 404), so fail closed.
  if (inferred === 'site_relative') return null;

  // Protocol-relative media needs only a scheme. Borrowing http/https from the configured API is
  // safe because it does not change the media host; unlike site-relative URLs, no host is invented.
  try {
    const source = new URL(schemeSourceUrl || getVerificationApiBaseUrl());
    if (source.protocol !== 'https:' && source.protocol !== 'http:') return null;
    return `${source.protocol}${trimmed}`;
  } catch {
    return null;
  }
}

export function resolveMarketplacePrimaryImage(
  listing: { primary_image_state: MobilePrimaryImageState; primary_image_url?: string | null },
  schemeSourceUrl?: string,
): string | null {
  if (!PUBLISHABLE_PRIMARY_IMAGE_STATES.has(listing.primary_image_state)) return null;
  return resolveMarketplaceMediaUrl(listing.primary_image_url, null, schemeSourceUrl);
}
"""
if text.count(old) != 1:
    raise SystemExit(f'marketplaceApi media helper anchor count = {text.count(old)}')
api.write_text(text.replace(old, new, 1))

test = root / 'mobile/tests/marketplace-media-contract.test.ts'
text = test.read_text()
old = """assert.equal(
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
"""
new = """// `site_relative` belongs to a browser viewing origin. Native has no such origin and must not
// silently reinterpret it as the API host. The staging UAT rows make this observable: the same
// /uat/owner/... path is not an API asset.
assert.equal(resolveMarketplaceMediaUrl('/uat/owner/hilux.svg', 'site_relative', base), null);
assert.equal(
  resolveMarketplaceMediaUrl('//cdn.carup.dev/hilux.jpg', 'protocol_relative', base),
  'https://cdn.carup.dev/hilux.jpg',
);
assert.equal(
  resolveMarketplaceMediaUrl('//cdn.carup.dev/hilux.jpg', 'protocol_relative', 'http://localhost:5001'),
  'http://cdn.carup.dev/hilux.jpg',
);
assert.equal(resolveMarketplaceMediaUrl('https://cdn.carup.dev/hilux.jpg'), 'https://cdn.carup.dev/hilux.jpg');
assert.equal(resolveMarketplaceMediaUrl('data:image/png;base64,AAAA', null, base), null);
assert.equal(resolveMarketplaceMediaUrl('/good.jpg', 'absolute_https', base), null);
assert.equal(
  resolveMarketplacePrimaryImage({ primary_image_state: 'none', primary_image_url: 'https://cdn.carup.dev/stale.jpg' }, base),
  null,
);
assert.equal(
  resolveMarketplacePrimaryImage({ primary_image_state: 'seller_primary', primary_image_url: '/good.jpg' }, base),
  null,
);
assert.equal(
  resolveMarketplacePrimaryImage({ primary_image_state: 'seller_primary', primary_image_url: 'https://cdn.carup.dev/good.jpg' }),
  'https://cdn.carup.dev/good.jpg',
);
"""
if text.count(old) != 1:
    raise SystemExit(f'mobile media test anchor count = {text.count(old)}')
test.write_text(text.replace(old, new, 1))
