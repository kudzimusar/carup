/**
 * Loopback Owner UAT using real CarUp routes and SQL. Authentication accounts,
 * OCR output and private object storage are disposable test fixtures.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';

const url = new URL(process.env.CARUP_IDV_TEST_DATABASE_URL || 'about:blank');
if (process.env.CARUP_IDV_TEST_DISPOSABLE !== 'yes' || !/^postgres(?:ql)?:$/.test(url.protocol)
  || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  || !/^\/carup_idv_test_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash) {
  throw new Error('An explicit disposable loopback identity database is required.');
}
const password = process.env.CARUP_IDV_TEST_PASSWORD;
if (!password || password.length < 16) throw new Error('Set an ephemeral synthetic password (16 characters minimum).');
const port = Number(process.env.CARUP_IDV_TEST_PREVIEW_PORT || 5074);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback preview port.');
const base = `http://127.0.0.1:${port}`;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const db = new pg.Pool({ connectionString: url.href });
if (!(await db.query("SELECT to_regprocedure('public.claim_identity_review_attempt(text,text)') IS NOT NULL AS ready")).rows[0].ready) {
  throw new Error('Apply the identity integration migration harness first.');
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'lr13-disposable-fixture',
  CARUP_IDENTITY_OCR_ENABLED: process.env.CARUP_IDV_TEST_OCR_UNAVAILABLE === 'yes' ? 'false' : 'true',
  CARUP_OCR_PROVIDER: process.env.CARUP_IDV_TEST_LOCAL_OCR === 'yes' ? 'local-tesseract' : 'cloudflare',
  CARUP_OCR_MODEL: '@cf/qwen/qwen3.8-27b',
  CLOUDFLARE_ACCOUNT_ID: 'lr13-fixture',
  CLOUDFLARE_API_TOKEN: 'lr13-synthetic-only',
  SENTRY_DSN: '',
});
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const target = new URL(input instanceof Request ? input.url : input);
  if (target.href === 'https://api.cloudflare.com/client/v4/accounts/lr13-fixture/ai/run/@cf/qwen/qwen3.8-27b') {
    const prompt = JSON.parse(init.body).messages[0].content;
    const number = process.env.CARUP_IDV_TEST_SIDE_CONFLICT === 'yes' && prompt.startsWith('Transcribe') && prompt.includes('on the back')
      ? 'TEST999999' : 'TEST123456';
    return Promise.resolve(Response.json({
      success: true,
      result: { choices: [{ message: { content: JSON.stringify({
        document_class_observed: 'passport',
        legible: true,
        fields: { first_name: 'Synthetic', last_name: 'Applicant', national_id_number: number, passport_number: number, date_of_birth: '1992-01-01' },
      }) } }] },
    }));
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('External requests are disabled for the identity fixture.');
  return nativeFetch(input, init);
};

const { supabase } = await import('../../db/supabase.js');
const { default: applicantRoutes } = await import('../../routes/identityVerificationRoutes.js');
const { default: reviewerRoutes } = await import('../../routes/identityVerificationAdminRoutes.js');
const { default: errorHandler } = await import('../../middleware/errorMiddleware.js');
const { csrfMiddleware, generateCsrfToken } = await import('../../middleware/securityMiddleware.js');
const { authorizeSessionRole } = await import('../../middleware/authMiddleware.js');
const { hashPassword, verifyPassword } = await import('../../utils/passwordAuth.js');

function identifier(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Unexpected SQL identifier in test adapter.');
  return '"' + name + '"';
}

class SqlQuery {
  constructor(table) {
    this.table = 'public.' + identifier(table);
    this.columns = '*';
    this.filter = [];
    this.values = [];
    this.sqlOrder = '';
    this.sqlLimit = '';
  }

  parameter(value) {
    this.values.push(value);
    return '$' + this.values.length;
  }

  select(columns = '*') {
    this.columns = columns === '*' ? columns : columns.split(',').map(key => identifier(key.trim())).join(', ');
    return this;
  }

  eq(column, value) { this.filter.push(identifier(column) + ' = ' + this.parameter(value)); return this; }
  order(column, { ascending = true } = {}) { this.sqlOrder = ' ORDER BY ' + identifier(column) + (ascending ? ' ASC' : ' DESC'); return this; }
  limit(size) { this.sqlLimit = ' LIMIT ' + this.parameter(size); return this; }

  insert(data) {
    const columns = Object.keys(data);
    this.mutation = `INSERT INTO ${this.table} (${columns.map(identifier).join(', ')}) VALUES (${columns.map(column => this.parameter(data[column])).join(', ')})`;
    return this;
  }

  upsert(data, { onConflict }) {
    this.insert(data);
    const updates = Object.keys(data).filter(key => key !== onConflict).map(key => `${identifier(key)} = EXCLUDED.${identifier(key)}`);
    this.mutation += ` ON CONFLICT (${identifier(onConflict)}) DO UPDATE SET ${updates.join(', ')}`;
    return this;
  }

  update(data) {
    const assignments = Object.entries(data).map(([key, value]) => identifier(key) + ' = ' + this.parameter(value));
    this.mutation = `UPDATE ${this.table} SET ${assignments.join(', ')}`;
    return this;
  }

  async execute(single = false) {
    const where = this.filter.length ? ' WHERE ' + this.filter.join(' AND ') : '';
    const sql = this.mutation ? this.mutation + where + ' RETURNING ' + this.columns
      : `SELECT ${this.columns} FROM ${this.table}${where}${this.sqlOrder}${this.sqlLimit}`;
    try {
      const { rows } = await db.query(sql, this.values);
      if (single && rows.length > 1) throw new Error('Expected a single row.');
      return { data: single ? rows[0] ?? null : rows, error: null };
    } catch (error) {
      return { data: null, error: { code: error.code, message: error.message } };
    }
  }

  single() { return this.execute(true); }
  maybeSingle() { return this.execute(true); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

supabase.from = table => new SqlQuery(table);
supabase.rpc = async (name, args) => {
  try {
    const named = Object.keys(args).map((key, index) => `${identifier(key)} => $${index + 1}`);
    const { rows } = await db.query(`SELECT public.${identifier(name)}(${named.join(', ')}) AS result`, Object.values(args));
    return { data: rows[0].result, error: null };
  } catch (error) {
    return { data: null, error: { code: error.code, message: error.message } };
  }
};

// The synthetic object store persists actual uploaded bytes privately in the
// disposable database. Its random expiring preview URLs never expose object paths.
await db.query(`CREATE TABLE IF NOT EXISTS storage.lr13_objects (
  object_path text PRIMARY KEY, bytes bytea NOT NULL, mime_type text NOT NULL
)`);
const signed = new Map();
async function storedObject(path) {
  return (await db.query('SELECT bytes, mime_type FROM storage.lr13_objects WHERE object_path=$1', [path])).rows[0];
}
const storage = supabase.storage;
storage.from = bucket => {
  if (bucket !== 'ocr-documents') throw new Error('Only private identity fixtures are supported.');
  return {
    async upload(path, bytes, { contentType }) {
      await db.query('INSERT INTO storage.lr13_objects VALUES ($1,$2,$3)', [path, bytes, contentType]);
      return { data: { path }, error: null };
    },
    async download(path) {
      const object = await storedObject(path);
      return object ? { data: new Blob([object.bytes], { type: object.mime_type }), error: null }
        : { error: { message: 'Test object unavailable' } };
    },
    async remove(paths) {
      await db.query('DELETE FROM storage.lr13_objects WHERE object_path=ANY($1::text[])', [paths]);
      return { error: null };
    },
    async createSignedUrl(path, seconds) {
      if (!await storedObject(path)) return { error: { message: 'Test object unavailable' } };
      const token = randomBytes(24).toString('hex');
      signed.set(token, { path, expiresAt: Date.now() + seconds * 1000 });
      return { data: { signedUrl: `${base}/private-fixture/${token}` }, error: null };
    },
  };
};
Object.defineProperty(supabase, 'storage', { value: storage });

const accountHash = await hashPassword(password);
for (const [id, name, email, role] of [
  ['lr13-applicant', 'Synthetic Applicant', 'applicant@lr13.example.invalid', 'owner'],
  ['lr13-reviewer', 'Synthetic Reviewer', 'reviewer@lr13.example.invalid', 'admin'],
  ['lr14-reviewer-two', 'Synthetic Second Reviewer', 'reviewer-two@lr13.example.invalid', 'admin'],
  ['lr14-applicant-two', 'Synthetic Second Applicant', 'applicant-two@lr13.example.invalid', 'owner'],
]) {
  await db.query(`INSERT INTO public.users(id,name,email,role,join_date,password_hash)
    VALUES($1,$2,$3,$4,'2026-11-18',$5) ON CONFLICT(id) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
  [id, name, email, role, accountHash]);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));
app.get('/api/security/csrf-token', (req, res) => {
  const csrfToken = generateCsrfToken(req.get('x-user-id'), req.get('x-session-token'));
  res.cookie('csrf-token', csrfToken, { sameSite: 'lax' });
  res.json({ csrfToken });
});
app.use('/api', (req, res, next) => {
  req.headers['x-verify-csrf'] = 'true';
  csrfMiddleware(req, res, next);
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const entry = (await db.query('SELECT id,name,role,password_hash FROM public.users WHERE email=$1 AND id IN ($2,$3,$4,$5)',
      [req.body.email, 'lr13-applicant', 'lr13-reviewer', 'lr14-reviewer-two', 'lr14-applicant-two'])).rows[0];
    if (!entry || !await verifyPassword(req.body.password, entry.password_hash)) return res.sendStatus(401);
    const { id, name, role } = entry;
    const token = randomBytes(32).toString('hex');
    await db.query("INSERT INTO public.user_sessions(id,user_id,token,is_valid,expires_at) VALUES ($1,$2,$3,true,now()+interval '1 hour')",
      [randomUUID(), id, token]);
    res.json({ user: { id, name, role }, token });
  } catch (error) { next(error); }
});
app.get('/api/auth/session', authorizeSessionRole(), (_req, res) => res.json({ success: true }));
app.use(applicantRoutes);
app.use(reviewerRoutes);
app.get('/private-fixture/:token', async (req, res, next) => {
  try {
    const proof = signed.get(req.params.token);
    if (!proof || proof.expiresAt <= Date.now()) {
      signed.delete(req.params.token);
      return res.sendStatus(404);
    }
    const object = await storedObject(proof.path);
    if (!object) return res.sendStatus(404);
    return res.set('Cache-Control', 'no-store').type(object.mime_type).send(object.bytes);
  } catch (error) { next(error); }
});
app.use('/api', (_req, res) => res.sendStatus(404));
const dist = join(root, 'web/dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
app.use(errorHandler);
app.listen(port, '127.0.0.1', () => console.log(`LR13 disposable PostgreSQL preview at ${base}`));
