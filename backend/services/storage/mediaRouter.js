import express from 'express';
import crypto from 'crypto';
import { uploadToStorage, generateSecureReadUrl } from './storageService.js';
import { authorizeRole } from '../../middleware/authMiddleware.js';

const router = express.Router();

/**
 * Utility: Parse Base64 Image string into MimeType and Binary Buffer
 */
function parseBase64Payload(base64Str) {
  const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid Base64 payload format. Must include data URI scheme prefix.');
  }

  const mimeType = matches[1];
  const fileBuffer = Buffer.from(matches[2], 'base64');
  return { mimeType, fileBuffer };
}

/**
 * POST /api/media/upload/vehicle - Public vehicle listing photos upload
 * 
 * Takes an array of base64 strings or a single base64 string, processes it,
 * uploads to the public 'vehicle-images' bucket, and returns public WebP/JPEG URLs.
 */
router.post('/upload/vehicle', async (req, res) => {
  const { images, vin } = req.body;

  if (!images || !vin) {
    return res.status(400).json({ error: 'Missing mandatory parameters: images, vin' });
  }

  const imageList = Array.isArray(images) ? images : [images];
  const uploadedUrls = [];

  console.log(`📸 [Media Router] Processing upload for ${imageList.length} vehicle image(s) for VIN: [${vin}]`);

  try {
    for (let idx = 0; idx < imageList.length; idx++) {
      const base64Str = imageList[idx];
      const { mimeType, fileBuffer } = parseBase64Payload(base64Str);

      // Generate a secure, unique, and sequential filename
      const fileExt = mimeType.split('/')[1] || 'jpg';
      const randomString = crypto.randomBytes(4).toString('hex');
      const fileName = `${vin.toUpperCase()}/img_${idx + 1}_${randomString}.${fileExt}`;

      // Upload via storage service (runs JPEG EXIF metadata stripping internally!)
      const publicUrl = await uploadToStorage('vehicle-images', fileName, fileBuffer, mimeType);
      uploadedUrls.push(publicUrl);
    }

    res.json({ urls: uploadedUrls });

  } catch (err) {
    console.error('❌ [Media Router] Vehicle image upload failed:', err.message);
    res.status(500).json({ error: err.message || 'Media pipeline upload error' });
  }
});

/**
 * POST /api/media/upload/document - Private secure document upload (KYC, ZIMRA logbooks, clearances)
 * 
 * Encrypted/restricted storage. Returns the secure path instead of a public URL.
 */
router.post('/upload/document', authorizeRole(), async (req, res) => {
  const { document, docType, vin } = req.body;
  const userId = req.headers['x-user-id'] || 'system';

  if (!document || !docType || !vin) {
    return res.status(400).json({ error: 'Missing mandatory parameters: document, docType, vin' });
  }

  console.log(`📄 [Media Router] Uploading secure [${docType}] for VIN: [${vin}] by user: [${userId}]`);

  try {
    const { mimeType, fileBuffer } = parseBase64Payload(document);

    // Generate unique secure filename
    const fileExt = mimeType.split('/')[1] || 'pdf';
    const randomString = crypto.randomBytes(6).toString('hex');
    const fileName = `${vin.toUpperCase()}/${docType.toLowerCase()}_${randomString}.${fileExt}`;

    // Upload to private bucket (returns secure relative storage path)
    const storagePath = await uploadToStorage('ocr-documents', fileName, fileBuffer, mimeType);

    res.json({ 
      storagePath,
      docType,
      vin,
      uploadedBy: userId
    });

  } catch (err) {
    console.error('❌ [Media Router] Secure document upload failed:', err.message);
    res.status(500).json({ error: err.message || 'Secure document pipeline upload error' });
  }
});

/**
 * GET /api/media/document/signed-url - Retrieve a timed read token for a private document
 */
router.get('/document/signed-url', authorizeRole(['admin', 'government', 'owner']), async (req, res) => {
  const { path } = req.query;

  if (!path) {
    return res.status(400).json({ error: 'Missing mandatory query parameter: path' });
  }

  try {
    const signedUrl = await generateSecureReadUrl('ocr-documents', path, 3600); // Expires in 1 hour
    res.json({ signedUrl });
  } catch (err) {
    console.error('❌ [Media Router] Signed URL generation failed:', err.message);
    res.status(500).json({ error: 'Failed to authorize and retrieve secure document' });
  }
});

export default router;
