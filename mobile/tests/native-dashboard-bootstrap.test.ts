/**
 * OC-NATIVE-LR1 auth bootstrap / Home personalization guard.
 *
 * Home is now a public consumer surface. Auth restoration may add owner
 * personalization after bootstrap, but it must never redirect a guest away
 * from Home or flash private owner data before auth is known.
 */
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(process.cwd(), 'app/(tabs)/index.tsx'), 'utf8');

assert.doesNotMatch(source, /Redirect\b|resolveDashboardGate|role\.overview/, 'Home must not be a role-owned dashboard redirect');
assert.match(source, /authLoading\s*=\s*useAuthStore/, 'Home must observe auth bootstrap');
assert.match(source, /isOwner\s*=\s*!authLoading\s*&&\s*isAuthenticated/, 'owner personalization must wait for bootstrap');
assert.match(source, /enabled:\s*isOwner/, 'owner-only queries must be disabled for guests and while bootstrap is pending');
assert.match(source, /getMarketplaceListings/, 'public Home must still load real Marketplace truth for guests');
assert.doesNotMatch(source, /Stakeholder Portal Switching|multi-tenant|authorization context/i, 'legacy architecture UX must not return to Home');

console.log('native-dashboard-bootstrap.test: PASS');
