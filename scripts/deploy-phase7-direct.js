import pg from 'pg';

const connectionString = 'postgresql://postgres.vhmnajoeicasaigiophh:[ROTATED-SEE-CR1]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

const client = new pg.Client({
  connectionString,
});

const statements = [
  // 0. Drop legacy listing_images to resolve schema collision
  `DROP TABLE IF EXISTS listing_images CASCADE;`,

  // 1. Create listing_images table
  `CREATE TABLE IF NOT EXISTS listing_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vin TEXT NOT NULL,
    image_url TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE
  );`,

  // 2. Create index on listing_images
  `CREATE INDEX IF NOT EXISTS idx_listing_images_vin ON listing_images (vin);`,

  // 3. Create vehicle_documents table
  `CREATE TABLE IF NOT EXISTS vehicle_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vin TEXT NOT NULL,
    document_type TEXT NOT NULL,
    document_url TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'pending',
    uploaded_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
  );`,

  // 4. Provision Supabase Storage buckets via PL/pgSQL
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
       INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
       VALUES (
         'vehicle-images', 
         'vehicle-images', 
         true, 
         15728640,
         ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
       )
       ON CONFLICT (id) DO UPDATE SET 
         public = EXCLUDED.public,
         file_size_limit = EXCLUDED.file_size_limit,
         allowed_mime_types = EXCLUDED.allowed_mime_types;

       INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
       VALUES (
         'ocr-documents', 
         'ocr-documents', 
         false, 
         15728640,
         ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
       )
       ON CONFLICT (id) DO UPDATE SET 
         public = EXCLUDED.public,
         file_size_limit = EXCLUDED.file_size_limit,
         allowed_mime_types = EXCLUDED.allowed_mime_types;
     END IF;
   END $$;`
];

async function deploy() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL database on Supabase.');

    for (let i = 0; i < statements.length; i++) {
      console.log(`Executing Phase 7 statement #${i + 1}...`);
      await client.query(statements[i]);
    }
    
    console.log('✅ All Phase 7 database structures successfully provisioned!');
  } catch (err) {
    console.error('❌ Error executing statement:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

deploy();
