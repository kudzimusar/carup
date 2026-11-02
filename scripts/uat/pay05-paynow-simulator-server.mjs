#!/usr/bin/env node
/**
 * CARUP-PAY-05-LR01 — the LOCAL Paynow protocol simulator over HTTP (Level 1 UAT only).
 *
 * Serves backend/services/payment/pay05PaynowSimulator.js on 127.0.0.1 so CarUp's REAL adapter talks HTTP to it exactly
 * as it would to https://www.paynow.co.zw (form-encoded, SHA-512 hashes, poll URLs, hosted page, status updates POSTed to
 * CarUp's resulturl and resent on HTTP errors). It refuses any production runtime and binds loopback only.
 *
 * Test controls (never part of Paynow's merchant API) live under /__control/ and require the per-run control token:
 *   POST /__control/integrations            issue a simulated integration (what Paynow would give the garage)
 *   GET  /__control/transactions            list transactions (no keys)
 *   POST /__control/transactions/:guid/status   { status, notify }  e.g. Paid, Disputed, Refunded, Cancelled
 *   POST /__control/transactions/:guid/resend   resend the current signed status update (Paynow's duplicate)
 *   POST /__control/transactions/:guid/forged   { status, tamper }  a status update signed with the WRONG key (body only)
 *   POST /__control/faults                  { kind: initiate|poll|trace, fault: { kind: … } }
 *   GET  /__control/otp                     the simulated SMS inbox (O'mari OTPs)
 *
 * CLI: node scripts/uat/pay05-paynow-simulator-server.mjs --port 5061 --control-token-file <path>
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PaynowProtocolSimulator } from '../../backend/services/payment/pay05PaynowSimulator.js';

const MAX_BODY = 64 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function httpDeliver(url, body) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)) return 0; // a local simulator only ever posts to a local CarUp
  const res = await fetch(target, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  return res.status;
}

const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};

export async function startPaynowSimulatorServer({ port = 0, controlToken = crypto.randomBytes(24).toString('hex'), deliver = httpDeliver,
  env = process.env, tickMs = 500 } = {}) {
  let simulator = null;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, simulator.origin);
      const body = req.method === 'POST' ? await readBody(req) : '';
      if (url.pathname.startsWith('/__control/')) {
        const supplied = String(req.headers['x-simulator-control-token'] ?? '');
        if (supplied.length !== controlToken.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(controlToken))) {
          return json(res, 403, { error: 'control token required' });
        }
        const input = body ? JSON.parse(body) : {};
        const route = url.pathname.replace(/^\/__control/, '');
        if (req.method === 'POST' && route === '/integrations') return json(res, 201, simulator.issueIntegration(input));
        if (req.method === 'GET' && route === '/transactions') {
          return json(res, 200, simulator.list().map(({ otp, ...tx }) => tx));
        }
        if (req.method === 'GET' && route === '/otp') return json(res, 200, simulator.otpOutbox);
        if (req.method === 'POST' && route === '/faults') { simulator.inject(input.kind, input.fault); return json(res, 200, { injected: true }); }
        if (req.method === 'POST' && route === '/run-due') return json(res, 200, { applied: await simulator.runDue() });
        const m = /^\/transactions\/([0-9a-f-]{36})\/(status|resend|forged)$/.exec(route);
        if (req.method === 'POST' && m) {
          if (m[2] === 'status') return json(res, 200, await simulator.setStatus(m[1], input.status, { notify: input.notify !== false }));
          if (m[2] === 'resend') return json(res, 200, await simulator.resend(m[1]));
          return json(res, 200, { body: simulator.forgedStatusMessage(m[1], { status: input.status ?? 'Paid', tamper: input.tamper === true }) });
        }
        return json(res, 404, { error: 'unknown control route' });
      }
      const reply = await simulator.handle({ method: req.method, path: `${url.pathname}${url.search}`, body });
      if (reply.status === 302) {
        res.writeHead(302, { location: reply.location });
        return res.end();
      }
      res.writeHead(reply.status, { 'content-type': reply.contentType ?? 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(reply.body);
    } catch (error) {
      // a thrown handler error is a simulated network failure: drop the connection without a reply
      req.socket.destroy();
      return undefined;
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  simulator = new PaynowProtocolSimulator({ origin, deliver, env });
  const timer = setInterval(() => { simulator.runDue().catch(() => null); }, tickMs);
  timer.unref();
  return {
    server, origin, simulator, controlToken,
    close: () => new Promise((resolve) => { clearInterval(timer); server.close(() => resolve()); }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const get = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const tokenFile = get('--control-token-file');
  const controlToken = tokenFile ? readFileSync(tokenFile, 'utf8').trim() : undefined;
  const started = await startPaynowSimulatorServer({ port: Number(get('--port') ?? 5061), controlToken });
  console.log(`PAY05_PAYNOW_SIMULATOR_READY ${started.origin} (SIMULATED PAYNOW — no real money moves)`);
  const stop = async () => { await started.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
