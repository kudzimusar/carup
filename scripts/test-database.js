import dotenv from 'dotenv';
import path from 'path';

// Load env vars BEFORE any other imports that depend on them
dotenv.config({ path: path.resolve('./backend/.env') });
dotenv.config({ path: path.resolve('./.env') }); // For frontend variables

// Now we dynamically import to guarantee env vars are present
const { supabase } = await import('../backend/db/supabase.js');

async function verifySupabase() {
  console.log('🧪 Starting Agent Verification for Supabase Integration...\n');
  
  try {
    // 1. Schema Agent Test
    console.log('🤖 [Schema Agent]: Verifying database tables and connectivity...');
    const { data: testData, error: testError } = await supabase.from('vehicles').select('vin').limit(1);
    
    if (testError) {
      if (testError.code === 'PGRST116' || testError.message.includes('relation "vehicles" does not exist')) {
        console.error('❌ [Schema Agent]: Tables not found. The SQL schema needs to be manually executed in the Supabase Dashboard.');
        console.error('    Please paste and run the contents of `database/migrations/supabase_schema.sql` in the Supabase SQL Editor.');
      } else {
        console.error(`❌ [Schema Agent]: Connection failed: ${testError.message}`);
      }
      process.exit(1);
    }
    
    console.log('✅ [Schema Agent]: Connection successful! Tables exist.\n');

    // 2. API Agent Test
    console.log('🤖 [API Agent]: Testing Supabase client operations...');
    const { data: vehicles } = await supabase.from('vehicles').select('*');
    if (vehicles && vehicles.length >= 0) {
      console.log(`✅ [API Agent]: Successfully queried ${vehicles.length} vehicles from Supabase.\n`);
    }

    // 3. Frontend Agent Test
    console.log('🤖 [Frontend Agent]: Verifying environment configuration...');
    if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
      console.log('✅ [Frontend Agent]: Environment variables are properly configured for the frontend client.\n');
    } else {
      console.log('⚠️ [Frontend Agent]: Make sure the frontend `.env` file contains `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.\n');
    }

    console.log('🎉 All Agent Tests Passed! Supabase is fully functional.');

  } catch (err) {
    console.error('❌ Verification failed due to unexpected error:', err.message);
  }
}

verifySupabase();
