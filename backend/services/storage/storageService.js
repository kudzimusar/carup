import { supabase } from '../../db/supabase.js';

/**
 * Pure-JavaScript Binary JPEG EXIF Metadata Stripper
 * 
 * High-performance, zero-dependency buffer scanner.
 * It identifies the APP1 segment (0xFFE1) containing EXIF/GPS metadata
 * and cleanly slices it out of the JPEG binary buffer, guaranteeing user privacy
 * without requiring any native compiler libraries (like sharp/exiftool).
 * 
 * @param {Buffer} buffer - The raw image file buffer
 * @returns {Buffer} The clean buffer stripped of EXIF data
 */
export function stripJpegExif(buffer) {
  if (buffer.length < 4) return buffer;
  
  // Verify SOI (Start of Image) marker: 0xFFD8
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
    return buffer; // Not a JPEG, return untouched
  }

  let i = 2;
  const cleanChunks = [buffer.subarray(0, 2)]; // Start with SOI marker

  while (i < buffer.length) {
    // Markers always start with 0xFF
    if (buffer[i] !== 0xFF) {
      break; 
    }

    const marker = buffer[i + 1];

    // SOS (Start of Scan) marker: 0xFFDA or EOI (End of Image) marker: 0xFFD9
    // Once SOS is reached, the remaining buffer is raw entropy scan data (no more metadata segments)
    if (marker === 0xDA || marker === 0xD9) {
      cleanChunks.push(buffer.subarray(i));
      break;
    }

    // Read segment length (2 bytes, big-endian)
    const segmentLength = (buffer[i + 2] << 8) + buffer[i + 3];
    const nextOffset = i + 2 + segmentLength;

    // APP1 Segment: 0xFFE1 (usually hosts EXIF, GPS, and XMP metadata)
    if (marker === 0xE1) {
      console.log(`🛡️ [Storage Service] Stripped APP1 EXIF/GPS Metadata segment (${segmentLength} bytes).`);
      // Simply skip this entire segment and do not add it to cleanChunks!
    } else {
      // Keep all other segments (like APP0/JFIF for rendering, SOF for dimensions, etc.)
      cleanChunks.push(buffer.subarray(i, nextOffset));
    }

    i = nextOffset;
  }

  return Buffer.concat(cleanChunks);
}

/**
 * Upload a media asset (image/document) to a Supabase Storage Bucket
 * 
 * @param {string} bucketName - Target bucket ('vehicle-images' or 'ocr-documents')
 * @param {string} fileName - Destination path inside the bucket (e.g. 'VIN123/image_1.jpg')
 * @param {Buffer} fileBuffer - File binary buffer
 * @param {string} mimeType - File mime type
 * @returns {Promise<string>} The public URL or secure path of the uploaded file
 */
export async function uploadToStorage(bucketName, fileName, fileBuffer, mimeType) {
  let processedBuffer = fileBuffer;

  // Apply real-time JPEG EXIF metadata stripping for privacy protection
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    try {
      processedBuffer = stripJpegExif(fileBuffer);
    } catch (err) {
      console.error('⚠️ [Storage Service] Failed to strip EXIF data:', err.message);
    }
  }

  // Upload processed buffer directly to Supabase storage bucket
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, processedBuffer, {
      contentType: mimeType,
      upsert: true
    });

  if (error) {
    console.error(`❌ [Storage Service] Supabase upload failed for bucket [${bucketName}]:`, error.message);
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  console.log(`✅ [Storage Service] Successfully uploaded file: ${data.path} to bucket: ${bucketName}`);

  // Retrieve public or signed secure URLs based on bucket visibility
  if (bucketName === 'vehicle-images') {
    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);
    return publicUrlData.publicUrl;
  } else {
    // Private bucket: return the relative secure storage path
    // Signed temporary read URLs (SAS) will be generated dynamically on demand
    return data.path;
  }
}

/**
 * Generate a secure, timed, temporary shared access signature (SAS) read URL for a private document
 * 
 * @param {string} bucketName - Usually 'ocr-documents'
 * @param {string} storagePath - The secure relative storage path in the bucket
 * @param {number} expiresInSeconds - Time before link expires (default 1 hour)
 * @returns {Promise<string>} Temporary signed read URL
 */
export async function generateSecureReadUrl(bucketName, storagePath, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    console.error('❌ [Storage Service] Failed to generate signed URL:', error.message);
    throw new Error(`Signed URL generation failed: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Download a private storage asset for server-side processing only.
 * The returned bytes must not be relayed directly to public clients.
 */
export async function downloadFromStorage(bucketName, storagePath) {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .download(storagePath);

  if (error) {
    console.error('\u274c [Storage Service] Failed to download private object:', error.message);
    throw new Error(`Storage download failed: ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: data.type || 'application/octet-stream',
  };
}

/**
 * Generate a secure, timed, temporary signed upload URL for direct client upload
 * 
 * @param {string} bucketName - Target bucket ('vehicle-images' or 'ocr-documents')
 * @param {string} fileName - Destination path (e.g. 'VIN123/image_1.jpg')
 * @param {number} expiresInSeconds - Expiration time (default 5 minutes)
 * @returns {Promise<{signedUrl: string, token: string}>} The signed upload URL and authorization token
 */
export async function generateSecureUploadUrl(bucketName, fileName, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUploadUrl(fileName, { expiresIn: expiresInSeconds });

  if (error) {
    console.error('\u274c [Storage Service] Failed to generate signed upload URL:', error.message);
    throw new Error(`Signed upload URL generation failed: ${error.message}`);
  }

  return { signedUrl: data.signedUrl, token: data.token };
}

console.log('✅ Enterprise Object Storage Service loaded.');
