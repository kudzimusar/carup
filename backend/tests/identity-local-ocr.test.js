import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { runLocalIdentityOcr } from '../services/identity/localIdentityOcr.js';
import { configuredIdentityOcrAdapter } from '../services/identity/identityOcrAdapter.js';

test('local OCR requires explicit selection and only returns uncertain classification', async () => {
  assert.equal(configuredIdentityOcrAdapter({ CARUP_OCR_PROVIDER: 'local-tesseract' }), null);
  const adapter = configuredIdentityOcrAdapter({ CARUP_IDENTITY_OCR_ENABLED: 'true', CARUP_OCR_PROVIDER: 'local-tesseract' });
  const result = await adapter.classifyDocument(null, null, null, 'passport');
  assert.equal(result.classification, 'uncertain');
  assert.equal(result.observationsOnly, true);
  assert.equal((await adapter.classifyDocument(null, null, null, 'registration_book')).observationsOnly, false);
});

test('local worker timeout and actual child exit return sanitized failures', async () => {
  const dummy = Buffer.from('unused');
  await assert.rejects(runLocalIdentityOcr(dummy, 'passport', { timeoutMs: 1 }), /timed out/);
  await assert.rejects(runLocalIdentityOcr(dummy, 'passport', {
    start: () => spawn(process.execPath, ['-e', 'process.exit(1)'],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }),
  }), /exited without observations/);
});

test('malformed worker reply is refused and releases its slot', async () => {
  let terminated = 0;
  const start = () => {
    const child = new EventEmitter();
    child.kill = () => { terminated++; child.emit('close'); };
    child.send = () => queueMicrotask(() => child.emit('message', { fields: [], legible: true }));
    return child;
  };
  for (let i = 0; i < 3; i++) {
    await assert.rejects(runLocalIdentityOcr(Buffer.alloc(0), 'passport', { start }), /invalid response/);
  }
  assert.equal(terminated, 3);
});
