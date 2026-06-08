import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const serverModule = await import('../server.js');

test('server exports the Express app as the Vercel default handler', () => {
  assert.equal(serverModule.default, serverModule.app);
  assert.equal(typeof serverModule.default, 'function');
});
