import assert from 'node:assert/strict';
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
