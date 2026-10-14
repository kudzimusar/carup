import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(app.expo.sdkVersion, '54.0.0', 'OC-NATIVE-10 must not hide an SDK migration');
assert.equal(app.expo.newArchEnabled, true, 'New Architecture is required by the current native dependency set');
assert.equal(app.expo.ios.supportsTablet, false, 'tablet enablement remains a separate product decision');

assert.equal(eas.build['android-device'].distribution, 'internal');
assert.equal(eas.build['android-device'].android.buildType, 'apk');
assert.equal(eas.build['ios-simulator'].ios.simulator, true);
assert.equal(eas.build['ios-device'].distribution, 'internal');

assert.equal(Boolean(pkg.dependencies?.['expo-dev-client']), false, 'this bounded preview path must not silently add expo-dev-client');
assert.equal(pkg.dependencies?.['react-native-reanimated'], '~4.1.1');
assert.equal(pkg.dependencies?.['react-native-worklets'], '0.5.1');
assert.equal(pkg.dependencies?.['@shopify/flash-list'], '2.0.2');
assert.equal(pkg.dependencies?.['expo-camera'], '~17.0.10', 'Expo SDK 54 camera package must stay on the resolver-compatible line');
assert.ok(app.expo.plugins.some((entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-camera'), 'expo-camera config plugin must remain active');

console.log('native-build-config.test: PASS');
