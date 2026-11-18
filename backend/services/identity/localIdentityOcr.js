import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TD3_OBSERVATION_STATES = new Set(['not_applicable', 'not_observed', 'unreadable', 'checksums_pass', 'checksums_fail']);
const WORKER = fileURLToPath(new URL('./localIdentityOcrWorker.js', import.meta.url));
let activeWorkers = 0;

export async function runLocalIdentityOcr(image, docType, { start = fork, timeoutMs = 15_000 } = {}) {
  if (activeWorkers >= 2) throw new Error('Local OCR capacity is occupied.');
  const child = start(WORKER, [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced', execArgv: [], env: {},
  });
  activeWorkers++;
  child.once('close', () => { activeWorkers--; });
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => finish(new Error('Local OCR timed out.')), timeoutMs);
    let settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.kill('SIGKILL');
      if (error) reject(error);
      else resolve(value);
    }
    child.once('error', () => finish(new Error('Local OCR could not start.')));
    child.once('exit', () => finish(new Error('Local OCR exited without observations.')));
    child.once('message', message => {
      if (typeof message?.legible !== 'boolean' || !message.fields || typeof message.fields !== 'object'
        || Array.isArray(message.fields) || !Object.values(message.fields).every(value => typeof value === 'string')
        || !TD3_OBSERVATION_STATES.has(message.td3Mrz) || !Number.isFinite(message.peakRssKiB)) {
        finish(new Error('Local OCR returned an invalid response.'));
        return;
      }
      finish(null, message);
    });
    child.send({ image, docType }, error => { if (error) finish(new Error('Local OCR request failed.')); });
  });
}

export function localIdentityOcrProvider() {
  return {
    id: 'local-tesseract', model: 'tesseract.js/6.0.1-eng-best-int/1.0.0', observationsOnly: true,
    async extract({ images, docType }) {
      const { peakRssKiB, ...content } = await runLocalIdentityOcr(Buffer.from(images[0].base64, 'base64'), docType);
      return { content, peakRssKiB };
    },
  };
}
