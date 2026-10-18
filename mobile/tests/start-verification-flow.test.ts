/**
 * OC-NATIVE-LR1 identity-verification entry guard.
 *
 * Identity verification remains governed from Account. Vehicle Check / Verify is a distinct
 * high-value consumer journey and R5 makes that journey visibly prominent on Home.
 */
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const account = fs.readFileSync(path.resolve(process.cwd(), 'app/(tabs)/account.tsx'), 'utf8');
const intro = fs.readFileSync(path.resolve(process.cwd(), 'app/(auth)/verification/intro.tsx'), 'utf8');

assert.match(account, /label=["']Verification["']/, 'Account must surface Verification');
assert.match(account, /\/\(auth\)\/verification\/intro/, 'Verification action must route to the identity intro');
assert.match(account, /!isAuthenticated/, 'Account must not expose private actions as an authenticated session to guests');
assert.match(intro, /VerificationEntryGuard/, 'the identity flow must retain its entry authority guard');
assert.match(intro, /Reading is not approval/, 'identity intro must distinguish document reading from approval');

const home = fs.readFileSync(path.resolve(process.cwd(), 'app/(tabs)/index.tsx'), 'utf8');
assert.doesNotMatch(home, /Start Verification Flow|Stakeholder Portal Switching/, 'Home must not return to the legacy dashboard CTA hierarchy');
assert.match(home, /label=["']Verify["']/, 'Home must surface vehicle Check / Verify as a distinct high-value journey');

console.log('start-verification-flow.test: PASS');
