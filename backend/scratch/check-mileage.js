import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const { supabase } = await import('../backend/db/supabase.js');

async function checkMileage() {
  const vin = 'VIN89230489201948';
  const { data: vehicle, error } = await supabase.from('vehicles').select('*').eq('vin', vin).single();
  
  if (error) {
    console.error('❌ Supabase Query Error:', error.message);
  } else {
    console.log('✅ Supabase Query Success! Vehicle data:', vehicle);
  }
}

checkMileage();
