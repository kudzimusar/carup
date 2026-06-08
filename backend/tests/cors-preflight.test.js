import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { app } = await import('../server.js');

function request(server, { method, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      method,
      path,
      host: '127.0.0.1',
      port: server.address().port,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('production frontend preflight to auth login receives CORS approval', async () => {
  const server = http.createServer(app).listen(0);
  try {
    const res = await request(server, {
      method: 'OPTIONS',
      path: '/api/auth/login',
      headers: {
        origin: 'https://carup.vercel.app',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    assert.equal(res.statusCode, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://carup.vercel.app');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
    assert.match(res.headers['access-control-allow-methods'], /POST/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('auth login POST includes CORS header for production frontend origin', async () => {
  const server = http.createServer(app).listen(0);
  try {
    const res = await request(server, {
      method: 'POST',
      path: '/api/auth/login',
      headers: {
        origin: 'https://carup.vercel.app',
      },
      body: {
        email: 'nobody@example.com',
        password: 'password123',
      },
    });

    assert.equal(res.headers['access-control-allow-origin'], 'https://carup.vercel.app');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('disallowed origin does not receive CORS approval', async () => {
  const server = http.createServer(app).listen(0);
  try {
    const res = await request(server, {
      method: 'OPTIONS',
      path: '/api/auth/login',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    assert.notEqual(res.headers['access-control-allow-origin'], 'https://evil.example');
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
