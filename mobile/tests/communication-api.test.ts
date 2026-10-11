import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const api = readFileSync(resolve('utils/communicationApi.ts'), 'utf8');
const shell = readFileSync(resolve('app/(tabs)/_layout.tsx'), 'utf8');
const inbox = readFileSync(resolve('app/(tabs)/inbox.tsx'), 'utf8');
const conversation = readFileSync(resolve('app/inbox/[threadId].tsx'), 'utf8');
const account = readFileSync(resolve('app/(tabs)/account.tsx'), 'utf8');
const vehicle = readFileSync(resolve('app/vehicle/[vin].tsx'), 'utf8');

for (const marker of [
  '/api/communications/notifications',
  '/api/communications/threads',
  '/api/communications/preferences',
  '/api/communications/share',
]) {
  assert.ok(api.includes(marker), marker + ' must remain on the CarUp Communications API');
}
assert.ok(api.includes('/read'), 'conversation read receipts must use the CarUp thread route');
assert.ok(api.includes('fetchCsrfToken'), 'mutating Communications calls retain CSRF protection');
assert.ok(api.includes('x-session-token'), 'Communications remains session-bound');

assert.match(shell, /name=["']inbox["']/, 'Inbox is a permanent native shell destination');
assert.match(shell, /name=["']communications["'][\s\S]*?href:\s*null/, 'legacy Communications screen is hidden from the bottom shell');

assert.match(inbox, /listCommunicationThreads/, 'Inbox loads real CarUp threads');
assert.match(inbox, /listCommunicationNotifications/, 'Inbox loads real CarUp notifications');
assert.match(inbox, /\/inbox\/\$\{thread\.id\}/, 'Inbox opens the canonical conversation screen');

assert.match(conversation, /getCommunicationThread/, 'conversation detail loads server thread state');
assert.match(conversation, /markCommunicationThreadRead/, 'conversation detail persists read state');
assert.match(conversation, /sendCommunicationMessage/, 'conversation detail sends through CarUp');
assert.match(conversation, /channel:\s*['"]in_app['"]/, 'native composer sends an in-app CarUp message');
assert.match(conversation, /CarUp is the conversation record/, 'provider transport must not replace conversation identity');

for (const key of ['push_enabled', 'whatsapp_enabled', 'telegram_enabled', 'email_enabled']) {
  assert.ok(account.includes(key), 'Account must expose the ' + key + ' delivery preference');
}
assert.match(account, /updateCommunicationPreferences/, 'Account persists delivery preferences');

assert.match(vehicle, /createCommunicationShare/, 'Vehicle Detail uses the governed share endpoint');
assert.match(vehicle, /channel:\s*['"]whatsapp['"]/, 'WhatsApp share is provider-specific');
assert.match(vehicle, /logo-whatsapp/, 'WhatsApp action uses a recognizable provider icon');
assert.doesNotMatch(vehicle, /seller.*phone|phone.*seller/i, 'Vehicle Detail must not expose a raw seller phone number');

console.log('communication-api.test: PASS');
