import { createClient } from '@supabase/supabase-js';
import { ReferralEngineService } from '../backend/services/referral/referralEngineService.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../backend/.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in backend/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const referralService = new ReferralEngineService({ client: supabase });

async function runBackfill() {
  console.log('Starting Referral Wave A Backfill script...');

  // Fetch all users
  const { data: users, error: userError } = await supabase.from('users').select('id, email, role');
  if (userError) {
    console.error('Error fetching users:', userError);
    process.exit(1);
  }

  console.log(`Found ${users.length} users. Checking permanent code status...`);

  let provisioned = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    try {
      // Check if code exists manually to save console noise, though ensurePermanentMemberCode is idempotent
      const { data: existing } = await supabase
        .from('referral_codes')
        .select('id')
        .eq('owner_user_id', user.id)
        .eq('is_permanent', true)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      await referralService.ensurePermanentMemberCode(user.id, 'platform');
      console.log(`[SUCCESS] Provisioned permanent code for user: ${user.id} (${user.email})`);
      provisioned++;
    } catch (err) {
      console.error(`[ERROR] Failed to provision code for user ${user.id}:`, err.message);
      failed++;
    }
  }

  console.log('--- Backfill Complete ---');
  console.log(`Total Provisioned: ${provisioned}`);
  console.log(`Total Skipped (Already existed): ${skipped}`);
  console.log(`Total Failed: ${failed}`);
}

runBackfill();
