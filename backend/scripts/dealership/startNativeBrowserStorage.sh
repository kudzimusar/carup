#!/usr/bin/env bash
# CARUP-DEALER-ONB-001 R2: real open-source Supabase Storage API in the
# disposable local PostgreSQL 17 browser-test process; NOT a mocked storage
# response, not a shared Supabase project and never real customer documents.
set -euo pipefail
if [[ "${DEALER_ISOLATED_POSTGRES_URL:-}" != 'postgresql://postgres@127.0.0.1:5432/carup_dealer_isolated_ci' ]]; then
  echo 'DEALER_PRIVATE_STORAGE_REFUSED_NONISOLATED_DATABASE' >&2
  exit 1
fi
if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" || -z "${SUPABASE_ANON_KEY:-}" ||
      -z "${DEALER_BROWSER_LOCAL_JWT_SECRET:-}" ||
      -z "${DEALER_BROWSER_FIXTURE_JSON:-}" ]]; then
  echo 'DEALER_PRIVATE_STORAGE_MISSING_EPHEMERAL_AUTHORITY' >&2
  exit 1
fi
docker volume create carup-dealer-ci-evidence >/dev/null
docker run -d --name carup-dealer-ci-storage --network host \
  -e ANON_KEY="${SUPABASE_ANON_KEY}" \
  -e SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY}" \
  -e POSTGREST_URL=http://127.0.0.1:3004 \
  -e PGRST_JWT_SECRET="${DEALER_BROWSER_LOCAL_JWT_SECRET}" \
  -e AUTH_JWT_SECRET="${DEALER_BROWSER_LOCAL_JWT_SECRET}" \
  -e DATABASE_URL=postgresql://postgres@127.0.0.1:5432/carup_dealer_isolated_ci \
  -e PGPASSWORD="${PGPASSWORD}" \
  -e STORAGE_PUBLIC_URL=http://127.0.0.1:54321/storage/v1 \
  -e REQUEST_ALLOW_X_FORWARDED_PATH=true \
  -e FILE_SIZE_LIMIT=52428800 \
  -e STORAGE_BACKEND=file \
  -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
  -e GLOBAL_S3_BUCKET=carup-dealer-synthetic-evidence \
  -e TENANT_ID=carup-ephemeral-only \
  -e REGION=us-east-1 \
  -e ENABLE_IMAGE_TRANSFORMATION=false \
  -v carup-dealer-ci-evidence:/var/lib/storage \
  supabase/storage-api:v1.81.0 >/dev/null

for attempt in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:5000/status >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:5000/status >/dev/null
# The native 16-migration dealer fixture does not install the usual Supabase
# schema grants. The real Storage API has migrated its private storage schema,
# but a service-role JWT cannot create a private bucket until the same
# disposable PostgreSQL service role is granted schema/table usage.
# NEVER run this against a shared DB: the strict loopback DB guard above is
# required before any SQL executes. Do not grant broad anonymous privileges.
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import pg from 'pg'
const db=new pg.Client({
  connectionString:process.env.DEALER_ISOLATED_POSTGRES_URL,
  ssl:false,application_name:'dealer-ci-storage-service-role-grants'
})
await db.connect()
try{
  const objects=await db.query(
    "SELECT to_regclass('storage.buckets')::text AS buckets, to_regclass('storage.objects')::text AS objects"
  )
  assert.equal(objects.rows[0]?.buckets,'storage.buckets')
  assert.equal(objects.rows[0]?.objects,'storage.objects')
  await db.query('GRANT USAGE ON SCHEMA storage TO service_role')
  await db.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storage TO service_role')
  await db.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA storage TO service_role')
  const access=await db.query(
    "SELECT has_schema_privilege('service_role','storage','USAGE') AS service_schema, "+
    "has_table_privilege('service_role','storage.buckets','INSERT') AS service_bucket_write, "+
    "has_table_privilege('service_role','storage.objects','SELECT') AS service_object_read"
  )
  assert.deepEqual(access.rows[0],{
    service_schema:true,service_bucket_write:true,service_object_read:true,
  })
  console.log('DEALER_NATIVE_STORAGE_SERVICE_ROLE_GRANT PASS: isolated schema only; no anonymous role grant')
}finally{await db.end()}
NODE
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import {createClient} from '@supabase/supabase-js'
const client=createClient('http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}})
const {error}=await client.storage.createBucket('ocr-documents',
  {public:false,allowedMimeTypes:['application/pdf','image/png','image/jpeg']})
if(error)throw Error('NATIVE_PRIVATE_STORAGE_BUCKET_CREATION_FAILED: '+error.message)
const {data:bucket,error:readError}=await client.storage.getBucket('ocr-documents')
if(readError)throw Error('NATIVE_PRIVATE_STORAGE_BUCKET_READ_FAILED: '+readError.message)
assert.equal(bucket.public,false)
console.log('DEALER_NATIVE_STORAGE_READY: real Supabase Storage API, PostgreSQL metadata, private bucket, disposable file volume')
NODE
