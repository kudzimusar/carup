-- +migrate Up
CREATE TABLE IF NOT EXISTS saved_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  vin VARCHAR(17) REFERENCES vehicles(vin) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, vin)
);

-- We may need to add owner_id to vehicles if it doesn't exist, to track personal ownership outside of tenants
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vehicles' AND column_name='owner_id') THEN
        ALTER TABLE vehicles ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
