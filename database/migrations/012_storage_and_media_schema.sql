-- +migrate Up

-- Create listing_images table to link vehicle VIN to multiple public images
CREATE TABLE IF NOT EXISTS listing_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL,
  image_url TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE
);

-- Create index on listing_images for fast marketplace loading
CREATE INDEX IF NOT EXISTS idx_listing_images_vin ON listing_images (vin);

-- Create vehicle_documents table for secure files like logbooks and import approvals
CREATE TABLE IF NOT EXISTS vehicle_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vin TEXT NOT NULL,
  document_type TEXT NOT NULL, -- 'logbook', 'insurance', 'customs_duty', 'police_clearance'
  document_url TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  uploaded_by TEXT NOT NULL, -- user_id of the owner/dealer
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Provision Supabase storage buckets dynamically if the storage schema exists
-- Standard Supabase storage system tables are located in 'storage' schema
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    -- Provision public 'vehicle-images' bucket
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'vehicle-images', 
      'vehicle-images', 
      true, 
      15728640, -- 15MB limit
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    )
    ON CONFLICT (id) DO UPDATE SET 
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

    -- Provision private 'ocr-documents' bucket
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'ocr-documents', 
      'ocr-documents', 
      false, 
      15728640, -- 15MB limit
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    )
    ON CONFLICT (id) DO UPDATE SET 
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

-- +migrate Down
DROP INDEX IF EXISTS idx_listing_images_vin;
DROP TABLE IF EXISTS listing_images;
DROP TABLE IF EXISTS vehicle_documents;
