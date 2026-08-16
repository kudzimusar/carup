#!/usr/bin/env node
/**
 * Owner Experience staging-only UAT fixture.
 *
 * Hard-pinned to the CarUp staging project and the existing Owner UAT account.
 * No production ref, user id, VIN or SQL is accepted from input.
 * Modes: bootstrap | verify | cleanup.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const STAGING_REF = 'eoyenigwevnxwwhyhaer';
const FORBIDDEN_PROD_REF = ['vhmn', 'ajoe', 'icas', 'aigi', 'ophh'].join('');
const OWNER_ID = 'u_uat_ref_owner_2026';
const OWNER_EMAIL = 'uat-owner@carup.local';
const PREFIX = 'owner-uat-2026';

const OWNED_PUBLISHED_VIN = 'JTNBU4EE0J9UAT101';
const OWNED_DRAFT_VIN = 'WBA8E9C50JNUAT202';
const SAVED_MARKET_VIN = 'JF1GPAL60J9UAT303';
const FIXTURE_VINS = [OWNED_PUBLISHED_VIN, OWNED_DRAFT_VIN, SAVED_MARKET_VIN];

const MODE = (process.argv.find((arg) => arg.startsWith('--mode=')) || '--mode=verify').split('=')[1];
const fail = (message) => { console.error(`FAIL-CLOSED: ${message}`); process.exit(1); };

if (!['bootstrap', 'verify', 'cleanup'].includes(MODE)) fail(`unsupported mode ${MODE}`);

function tlsConfig() {
  const supplied = process.env.DIASPORA_STAGING_CA_CERT;
  if (supplied?.includes('BEGIN CERTIFICATE')) return { rejectUnauthorized: true, ca: supplied };
  const path = fileURLToPath(new URL('../../database/certs/supabase-prod-ca-2021.crt', import.meta.url));
  const ca = readFileSync(path, 'utf8');
  if (!ca.includes('BEGIN CERTIFICATE')) fail('bundled Supabase CA is not a PEM certificate');
  return { rejectUnauthorized: true, ca };
}

async function main() {
  const raw = process.env.DIASPORA_STAGING_DATABASE_URL;
  if (!raw) fail('DIASPORA_STAGING_DATABASE_URL is not set');
  if (raw.includes(FORBIDDEN_PROD_REF)) fail('database URL references forbidden production project');
  if (!raw.includes(STAGING_REF)) fail(`database URL does not positively identify staging ${STAGING_REF}`);

  const connectionString = raw.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '');
  const client = new pg.Client({ connectionString, ssl: tlsConfig(), statement_timeout: 30000 });
  await client.connect();

  const owner = (await client.query('SELECT id, email, role FROM public.users WHERE id = $1', [OWNER_ID])).rows[0];
  if (!owner) fail(`existing Owner UAT account ${OWNER_ID} is missing`);
  if (owner.email !== OWNER_EMAIL) fail(`Owner UAT account email mismatch: ${owner.email}`);
  if (owner.role !== 'owner') fail(`Owner UAT account role is ${owner.role}, expected owner`);

  const snapshot = async () => {
    const owned = Number((await client.query(
      'SELECT count(*)::int n FROM public.vehicles WHERE owner_id = $1 AND vin = ANY($2::text[])',
      [OWNER_ID, [OWNED_PUBLISHED_VIN, OWNED_DRAFT_VIN]],
    )).rows[0].n);
    const activeListings = Number((await client.query(
      `SELECT count(*)::int n FROM public.vehicles
       WHERE owner_id = $1 AND vin = ANY($2::text[]) AND publication_status = 'published' AND lower(status) IN ('available','reserved','active')`,
      [OWNER_ID, [OWNED_PUBLISHED_VIN, OWNED_DRAFT_VIN]],
    )).rows[0].n);
    const publicFixtureListings = Number((await client.query(
      `SELECT count(*)::int n FROM public.vehicles
       WHERE vin = ANY($1::text[]) AND publication_status = 'published' AND lower(status) IN ('available','reserved','active')`,
      [[OWNED_PUBLISHED_VIN, SAVED_MARKET_VIN]],
    )).rows[0].n);
    const saved = Number((await client.query(
      'SELECT count(*)::int n FROM public.saved_vehicles WHERE user_id = $1 AND vin = ANY($2::text[])',
      [OWNER_ID, [OWNED_PUBLISHED_VIN, SAVED_MARKET_VIN]],
    )).rows[0].n);
    const notifications = Number((await client.query(
      'SELECT count(*)::int n FROM public.notification_queue WHERE recipient_user_id = $1 AND dedupe_key LIKE $2',
      [OWNER_ID, `${PREFIX}:%`],
    )).rows[0].n);
    const unread = Number((await client.query(
      'SELECT count(*)::int n FROM public.notification_queue WHERE recipient_user_id = $1 AND dedupe_key LIKE $2 AND read = false',
      [OWNER_ID, `${PREFIX}:%`],
    )).rows[0].n);
    const images = Number((await client.query(
      'SELECT count(*)::int n FROM public.listing_images WHERE vin = ANY($1::text[])',
      [FIXTURE_VINS],
    )).rows[0].n);
    return { owned, activeListings, publicFixtureListings, saved, notifications, unread, images };
  };

  if (MODE === 'verify') {
    console.log(JSON.stringify({ mode: 'verify', owner, ...(await snapshot()) }, null, 2));
    await client.end();
    return;
  }

  if (MODE === 'cleanup') {
    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM public.notification_queue WHERE recipient_user_id = $1 AND dedupe_key LIKE $2', [OWNER_ID, `${PREFIX}:%`]);
      await client.query('DELETE FROM public.saved_vehicles WHERE user_id = $1 AND vin = ANY($2::text[])', [OWNER_ID, [OWNED_PUBLISHED_VIN, SAVED_MARKET_VIN]]);
      await client.query('DELETE FROM public.listing_images WHERE vin = ANY($1::text[])', [FIXTURE_VINS]);
      await client.query('DELETE FROM public.vehicles WHERE vin = ANY($1::text[])', [FIXTURE_VINS]);
      await client.query('COMMIT');
      console.log(JSON.stringify({ mode: 'cleanup', ok: true, ownerId: OWNER_ID }, null, 2));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    await client.end();
    return;
  }

  // Collision guard: never overwrite an unrelated vehicle that happens to use one of these VINs.
  const existing = (await client.query(
    'SELECT vin, owner_id, make, model FROM public.vehicles WHERE vin = ANY($1::text[])',
    [FIXTURE_VINS],
  )).rows;
  for (const row of existing) {
    const allowed = row.vin === SAVED_MARKET_VIN
      ? row.owner_id == null && row.make === 'Subaru' && row.model === 'Impreza'
      : row.owner_id === OWNER_ID;
    if (!allowed) fail(`fixture VIN collision on ${row.vin}; refusing to overwrite unrelated vehicle`);
  }

  await client.query('BEGIN');
  try {
    const vehicleRows = [
      {
        vin: OWNED_PUBLISHED_VIN, owner_id: OWNER_ID, make: 'Toyota', model: 'Corolla', generation: 'E210', trim: '1.8 Prestige', year: 2019,
        color: 'Silver Metallic', mileage: 68240, fuel_type: 'Petrol', drivetrain: 'FWD', transmission: 'Automatic', import_source: 'local',
        duty_paid: true, police_verified: true, status: 'Available', trust_score: 84, price: 9800, currency: 'USD', registration_country: 'Zimbabwe',
        current_seller_type: 'private', public_seller_display_enabled: false, vehicle_condition_category: 'locally_used', passport_verified: false,
        zimra_verified: false, safe_pay_ready: true, inspection_ready: true, publication_status: 'published',
      },
      {
        vin: OWNED_DRAFT_VIN, owner_id: OWNER_ID, make: 'BMW', model: '320i', generation: 'G20', trim: 'Sport Line', year: 2020,
        color: 'Alpine White', mileage: 41300, fuel_type: 'Petrol', drivetrain: 'RWD', transmission: 'Automatic', import_source: 'japan',
        duty_paid: true, police_verified: true, status: 'Available', trust_score: 90, price: 22500, currency: 'USD', registration_country: 'Zimbabwe',
        current_seller_type: 'private', public_seller_display_enabled: false, vehicle_condition_category: 'recently_imported', passport_verified: false,
        zimra_verified: true, safe_pay_ready: true, inspection_ready: true, publication_status: 'draft',
      },
      {
        vin: SAVED_MARKET_VIN, owner_id: null, make: 'Subaru', model: 'Impreza', generation: 'GT', trim: '2.0i-S Eyesight', year: 2018,
        color: 'Crystal White Pearl', mileage: 55700, fuel_type: 'Petrol', drivetrain: 'AWD', transmission: 'Automatic', import_source: 'japan',
        duty_paid: true, police_verified: true, status: 'Available', trust_score: 82, price: 12750, currency: 'USD', registration_country: 'Zimbabwe',
        current_seller_type: 'private', public_seller_display_enabled: false, vehicle_condition_category: 'recently_imported', passport_verified: false,
        zimra_verified: true, safe_pay_ready: true, inspection_ready: true, publication_status: 'published',
      },
    ];

    for (const v of vehicleRows) {
      await client.query(
        `INSERT INTO public.vehicles (
          vin, owner_id, make, model, generation, trim, year, color, mileage, fuel_type, drivetrain, transmission,
          import_source, duty_paid, police_verified, status, trust_score, price, currency, registration_country,
          current_seller_type, public_seller_display_enabled, vehicle_condition_category, passport_verified,
          zimra_verified, safe_pay_ready, inspection_ready, publication_status, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,now()
        )
        ON CONFLICT (vin) DO UPDATE SET
          owner_id=EXCLUDED.owner_id, make=EXCLUDED.make, model=EXCLUDED.model, generation=EXCLUDED.generation, trim=EXCLUDED.trim,
          year=EXCLUDED.year, color=EXCLUDED.color, mileage=EXCLUDED.mileage, fuel_type=EXCLUDED.fuel_type, drivetrain=EXCLUDED.drivetrain,
          transmission=EXCLUDED.transmission, import_source=EXCLUDED.import_source, duty_paid=EXCLUDED.duty_paid,
          police_verified=EXCLUDED.police_verified, status=EXCLUDED.status, trust_score=EXCLUDED.trust_score, price=EXCLUDED.price,
          currency=EXCLUDED.currency, registration_country=EXCLUDED.registration_country, current_seller_type=EXCLUDED.current_seller_type,
          public_seller_display_enabled=EXCLUDED.public_seller_display_enabled, vehicle_condition_category=EXCLUDED.vehicle_condition_category,
          passport_verified=EXCLUDED.passport_verified, zimra_verified=EXCLUDED.zimra_verified, safe_pay_ready=EXCLUDED.safe_pay_ready,
          inspection_ready=EXCLUDED.inspection_ready, publication_status=EXCLUDED.publication_status`,
        [v.vin,v.owner_id,v.make,v.model,v.generation,v.trim,v.year,v.color,v.mileage,v.fuel_type,v.drivetrain,v.transmission,
          v.import_source,v.duty_paid,v.police_verified,v.status,v.trust_score,v.price,v.currency,v.registration_country,
          v.current_seller_type,v.public_seller_display_enabled,v.vehicle_condition_category,v.passport_verified,
          v.zimra_verified,v.safe_pay_ready,v.inspection_ready,v.publication_status],
      );
    }

    await client.query('DELETE FROM public.listing_images WHERE vin = ANY($1::text[])', [FIXTURE_VINS]);
    const imageRows = [
      [OWNED_PUBLISHED_VIN, '/uat/owner/toyota-corolla.svg'],
      [OWNED_DRAFT_VIN, '/uat/owner/bmw-320i.svg'],
      [SAVED_MARKET_VIN, '/uat/owner/subaru-impreza.svg'],
    ];
    for (const [vin, imageUrl] of imageRows) {
      await client.query(
        'INSERT INTO public.listing_images (vin, image_url, is_primary, display_order) VALUES ($1,$2,true,0)',
        [vin, imageUrl],
      );
    }

    await client.query('DELETE FROM public.saved_vehicles WHERE user_id = $1 AND vin = ANY($2::text[])', [OWNER_ID, [OWNED_PUBLISHED_VIN, SAVED_MARKET_VIN]]);
    await client.query(
      `INSERT INTO public.saved_vehicles (user_id, vin)
       VALUES ($1,$2),($1,$3)
       ON CONFLICT (user_id, vin) DO NOTHING`,
      [OWNER_ID, OWNED_PUBLISHED_VIN, SAVED_MARKET_VIN],
    );

    await client.query('DELETE FROM public.notification_queue WHERE recipient_user_id = $1 AND dedupe_key LIKE $2', [OWNER_ID, `${PREFIX}:%`]);
    const notifications = [
      ['buyer-message', 'marketplace_inquiry', 'New buyer message', 'A buyer asked whether your Toyota Corolla is available for a viewing.', false, 'normal'],
      ['passport-review', 'evidence_review', 'BMW Passport evidence needs review', 'Your BMW 320i has evidence awaiting review before you publish it.', false, 'high'],
      ['listing-ready', 'listing_moderation', 'Toyota listing is live', 'Your Toyota Corolla is published in the staging Marketplace.', true, 'normal'],
    ];
    for (const [key, type, title, message, read, priority] of notifications) {
      await client.query(
        `INSERT INTO public.notification_queue (
          recipient_id, recipient_user_id, type, notification_type, title, message, channel, template_key,
          payload, priority, status, dedupe_key, scheduled_at, read, metadata, created_at, updated_at
        ) VALUES ($1,$1,$2,$2,$3,$4,'in_app','message_acknowledgement_v1',$5::jsonb,$6,'delivered',$7,now(),$8,$9::jsonb,now(),now())`,
        [OWNER_ID, type, title, message, JSON.stringify({ source: PREFIX }), priority, `${PREFIX}:${key}`, read, JSON.stringify({ fixture: PREFIX, transactional: true })],
      );
    }

    const state = await snapshot();
    const expected = { owned: 2, activeListings: 1, publicFixtureListings: 2, saved: 2, notifications: 3, unread: 2, images: 3 };
    for (const [key, value] of Object.entries(expected)) {
      if (state[key] !== value) throw new Error(`post-bootstrap assertion failed: ${key}=${state[key]}, expected ${value}`);
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({ mode: 'bootstrap', ok: true, owner, ...state, fixtureVins: FIXTURE_VINS }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  await client.end();
}

main().catch((error) => fail(error.message));
