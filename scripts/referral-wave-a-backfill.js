import { createClient } from '@supabase/supabase-js';
import { ReferralEngineService } from '../backend/services/referral/referralEngineService.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple arg parser
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const idx = args.indexOf(name);
  if (idx > -1 && idx + 1 < args.length) return args[idx + 1];
  const boolArg = args.find(a => a.startsWith(`${name}=`));
  if (boolArg) return boolArg.split('=')[1];
  return args.includes(name) ? true : def;
};

const isDryRun = getArg('--dry-run', false);
const batchSize = parseInt(getArg('--batch-size', 100), 10);
const tenantFilter = getArg('--tenant', null);
const envFile = getArg('--env-file', '../backend/.env');

dotenv.config({ path: path.resolve(__dirname, envFile) });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[FATAL] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  console.error('[FATAL] Do not use the anonymous key for this script.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const referralService = new ReferralEngineService({ client: supabase });

async function runBackfill() {
  console.log('--- Starting Referral Wave A Backfill ---');
  console.log(`Dry Run: ${isDryRun}`);
  console.log(`Batch Size: ${batchSize}`);
  console.log(`Tenant: ${tenantFilter || 'ALL'}`);

  let query = supabase.from('users').select('id, tenant_id');
  if (tenantFilter) {
    query = query.eq('tenant_id', tenantFilter);
  }

  const { data: users, error: userError } = await query;
  if (userError) {
    console.error('[ERROR] Error fetching users:', userError);
    process.exit(1);
  }

  console.log(`Found ${users.length} users. Processing in batches of ${batchSize}...`);

  let provisioned = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (user) => {
      try {
        const tenant = user.tenant_id || 'platform';
        
        // Exact filter for permanent MEMBER codes
        const { data: existing, error: existErr } = await supabase
          .from('referral_codes')
          .select('id')
          .eq('owner_user_id', user.id)
          .eq('is_permanent', true)
          .eq('code_type', 'MEMBER')
          .eq('tenant_id', tenant)
          .maybeSingle();
          
        if (existErr && existErr.code !== 'PGRST116') {
          throw existErr;
        }

        if (existing) {
          skipped++;
          return;
        }

        if (!isDryRun) {
          await referralService.ensurePermanentMemberCode(user.id, tenant);
          console.log(`[SUCCESS] Provisioned permanent code for user: ${user.id}`);
        } else {
          console.log(`[DRY-RUN] Would provision code for user: ${user.id}`);
        }
        provisioned++;
      } catch (err) {
        console.error(`[ERROR] Failed to provision code for user ${user.id}:`, err.message);
        failed++;
      }
    }));
  }

  console.log('--- Backfill Complete ---');
  console.log(`Total Provisioned (or Dry-Run intended): ${provisioned}`);
  console.log(`Total Skipped (Already existed): ${skipped}`);
  console.log(`Total Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runBackfill();
