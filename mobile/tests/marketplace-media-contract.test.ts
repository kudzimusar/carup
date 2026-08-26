import assert from 'node:assert/strict';
import {
  resolveMarketplaceMediaUrl,
  resolveMarketplacePrimaryImage,
} from '../utils/marketplaceApi';

const base = 'https://api.carup.dev/api';

// `site_relative` belongs to a browser viewing origin. Native has no such origin and must not
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

console.log('marketplace media contract: PASS');
