import dotenv from 'dotenv';
import { supabase } from './db/supabase.js';

dotenv.config();

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
