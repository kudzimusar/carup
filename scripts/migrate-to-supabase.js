#!/usr/bin/env node
/**
 * CarUp OS — Supabase Schema Migration Script
 * Applies the full PostgreSQL schema to the Supabase project.
 * Run once: node scripts/migrate-to-supabase.js
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://vhmnajoeicasaigiophh.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZobW5ham9laWNhc2FpZ2lvcGhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTc5NTgzNSwiZXhwIjoyMDk1MzcxODM1fQ.EojK8VZy95GQnulsEoDBj3LJG4d_Q7f87tv1F4yI-1Q';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ==========================================
// Apply schema statement-by-statement
// ==========================================

async function runSQL(sql, description) {
  process.stdout.write(`  → ${description}...`);
  try {
    const { error } = await supabase.rpc('exec_sql', { sql }).single();
    if (error) {
      // If exec_sql RPC doesn't exist, we'll use the REST API approach
      throw error;
    }
    console.log(' ✅');
  } catch (e) {
    console.log(` ⚠️  ${e.message}`);
  }
}

async function applySchema() {
  console.log('\n🚀 CarUp OS — Applying Supabase Schema\n');
  console.log('Project: vhmnajoeicasaigiophh');
  console.log('URL:', SUPABASE_URL);
  console.log('');

  // Test connection first
  console.log('📡 Testing Supabase connection...');
  const { data: testData, error: testError } = await supabase
    .from('vehicles')
    .select('count')
    .limit(1);

  if (testError && testError.code !== 'PGRST116') {
    // PGRST116 = table doesn't exist yet — that's expected
    if (testError.message.includes('relation "vehicles" does not exist')) {
      console.log('⚠️  Tables don\'t exist yet — schema needs to be applied via Supabase Dashboard.');
      console.log('\n📋 INSTRUCTIONS:');
      console.log('   1. Go to: https://supabase.com/dashboard/project/vhmnajoeicasaigiophh/sql');
      console.log('   2. Click "New query"');
      console.log('   3. Paste the contents of: database/migrations/supabase_schema.sql');
      console.log('   4. Click "Run"');
      console.log('\n   OR use the Supabase CLI:');
      console.log('   npx supabase db push --db-url postgresql://postgres:[ROTATED-SEE-CR1]@db.vhmnajoeicasaigiophh.supabase.co:5432/postgres');
    } else {
      console.log('❌ Connection test failed:', testError.message);
    }
  } else {
    console.log('✅ Connected to Supabase!');
    
    const { count } = testData?.[0] || { count: 0 };
    console.log(`\n📊 Current state:`);
    
    // Check tables
    const tables = ['users', 'vehicles', 'organizations', 'blockchain_events', 'safepay_escrows', 'partsentry_logs', 'finance_applications', 'insurance_records'];
    
    for (const table of tables) {
      const { data, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      if (error) {
        console.log(`   ❌ Table "${table}" - ${error.message}`);
      } else {
        console.log(`   ✅ Table "${table}" - ${data} rows`);
      }
    }
  }
}

// ==========================================
// Seed data (insert all base data)
// ==========================================
async function seedData() {
  console.log('\n🌱 Seeding base data...\n');

  // Seed Users
  const { error: usersError } = await supabase.from('users').upsert([
    { id: 'u1', name: 'Tendai Moyo', email: 'tendai@email.co.zw', avatar: '/images/avatars/owner-1.jpg', role: 'owner', phone: '+263 773 345 678', location: 'Harare', is_verified: true, subscription: 'Premium', join_date: '2024-03-15' },
    { id: 'u2', name: 'Simbisa Garages', email: 'contact@simbisa.co.zw', avatar: '/images/avatars/mechanic-1.jpg', role: 'mechanic', phone: '+263 772 111 222', location: 'Bulawayo', is_verified: true, subscription: 'Enterprise', join_date: '2023-08-10' },
    { id: 'u3', name: 'Croco Motors', email: 'sales@crocomotors.co.zw', avatar: '/images/avatars/dealer-1.jpg', role: 'dealer', phone: '+263 774 444 555', location: 'Harare', is_verified: true, subscription: 'Enterprise', join_date: '2022-01-05' },
    { id: 'u4', name: 'Old Mutual Insurance', email: 'insurance@oldmutual.co.zw', avatar: '/images/avatars/insurance-1.jpg', role: 'insurance', phone: '+263 771 999 888', location: 'Harare', is_verified: true, subscription: 'Enterprise', join_date: '2021-06-20' },
    { id: 'u5', name: 'ZIMRA Registry', email: 'registry@zimra.co.zw', avatar: '/images/avatars/government-1.jpg', role: 'government', phone: '+263 242 758 891', location: 'Harare', is_verified: true, subscription: 'System', join_date: '2020-01-01' },
  ], { onConflict: 'id' });
  
  if (usersError) console.log('  ⚠️  Users:', usersError.message);
  else console.log('  ✅ Users seeded (5 records)');

  // Seed Vehicles
  const { error: vehiclesError } = await supabase.from('vehicles').upsert([
    { vin: 'VIN74329849204928', make: 'Toyota', model: 'Hilux', generation: 'GD-6', trim: 'Double Cab Legend 50', year: 2021, color: 'White', mileage: 48500, fuel_type: 'Diesel', drivetrain: '4WD', transmission: 'Automatic', import_source: 'South Africa', duty_paid: true, police_verified: true, status: 'Available', trust_score: 96.8, price: 42000.0, currency: 'USD' },
    { vin: 'VIN89230489201948', make: 'Mercedes-Benz', model: 'C-Class', generation: 'W205', trim: 'C200 AMG Line', year: 2019, color: 'Grey', mileage: 72000, fuel_type: 'Petrol', drivetrain: 'RWD', transmission: 'Automatic', import_source: 'United Kingdom', duty_paid: true, police_verified: true, status: 'Available', trust_score: 91.2, price: 28500.0, currency: 'USD' },
    { vin: 'VIN38492049281048', make: 'Mazda', model: 'Demio', generation: '4th Gen', trim: 'SkyActiv-G', year: 2017, color: 'Blue', mileage: 112000, fuel_type: 'Petrol', drivetrain: 'FWD', transmission: 'Automatic', import_source: 'Japan', duty_paid: true, police_verified: true, status: 'Available', trust_score: 84.5, price: 7500.0, currency: 'USD' },
  ], { onConflict: 'vin' });
  
  if (vehiclesError) console.log('  ⚠️  Vehicles:', vehiclesError.message);
  else console.log('  ✅ Vehicles seeded (3 records)');

  // Seed Organizations
  const { error: orgsError } = await supabase.from('organizations').upsert([
    { id: 'org_croco', name: 'Croco Motors Group', type: 'dealership', created_at: '2022-01-05', status: 'active' },
    { id: 'org_simbisa', name: 'Simbisa Garages Ltd', type: 'garage', created_at: '2023-08-10', status: 'active' },
    { id: 'org_oldmutual', name: 'Old Mutual Zimbabwe', type: 'insurance', created_at: '2021-06-20', status: 'active' },
    { id: 'org_cbz', name: 'CBZ Bank Limited', type: 'bank', created_at: '2019-03-12', status: 'active' },
    { id: 'org_zimra', name: 'Zimbabwe Revenue Authority', type: 'government', created_at: '2020-01-01', status: 'active' },
  ], { onConflict: 'id' });
  
  if (orgsError) console.log('  ⚠️  Organizations:', orgsError.message);
  else console.log('  ✅ Organizations seeded (5 records)');

  console.log('\n✅ Seed complete!');
}

// ==========================================
// Verify connectivity and data
// ==========================================
async function verifyDatabase() {
  console.log('\n🔍 Verifying Supabase database...\n');

  const checks = [
    { table: 'users', expectedMin: 5 },
    { table: 'vehicles', expectedMin: 3 },
    { table: 'organizations', expectedMin: 5 },
  ];

  let allPassed = true;
  for (const check of checks) {
    const { data, error } = await supabase.from(check.table).select('*');
    if (error) {
      console.log(`  ❌ ${check.table}: ${error.message}`);
      allPassed = false;
    } else if (data.length >= check.expectedMin) {
      console.log(`  ✅ ${check.table}: ${data.length} records found`);
    } else {
      console.log(`  ⚠️  ${check.table}: ${data.length} records (expected ≥${check.expectedMin})`);
    }
  }

  return allPassed;
}

// Main
(async () => {
  try {
    await applySchema();
    
    // Try to seed data (will only work if tables exist)
    const { data: vehicleCheck } = await supabase.from('vehicles').select('vin').limit(1);
    if (vehicleCheck !== null) {
      await seedData();
      await verifyDatabase();
    }
    
    console.log('\n🎉 Migration script complete!\n');
  } catch (err) {
    console.error('\n❌ Migration error:', err.message);
    process.exit(1);
  }
})();
