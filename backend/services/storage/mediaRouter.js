import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { uploadToStorage, generateSecureReadUrl, generateSecureUploadUrl } from './storageService.js';
import { authorizeRole } from '../../middleware/authMiddleware.js';
import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';

const router = express.Router();

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

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
 * Validate MIME magic bytes to prevent MIME spoofing
 */
function verifyMimeMagicBytes(buffer, mimeType) {
  if (buffer.length < 4) {
    throw new Error('File payload too small to verify magic bytes.');
  }

  // PNG: 89 50 4E 47
  if (mimeType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }
  // JPEG: FF D8 FF
  else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }
  // PDF: 25 50 44 46 (%PDF)
  else if (mimeType === 'application/pdf') {
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  }
  
  return true; // Pass unrecognized types, but restrict allowed types
}

/**
 * Stub malware scanning hook
 */
function scanForMalware(buffer) {
  const content = buffer.toString('binary');

  // Check for EICAR test string signature
  if (content.includes('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')) {
    return { clean: false, reason: 'Malware signature matches EICAR test file.' };
  }

  // Check for suspicious script elements or tags embedded inside binaries
  const suspiciousPatterns = [
    '<?php',
    '<?=',
    '<script',
    'javascript:',
    'onload=',
    'onerror=',
    'eval(',
    'exec(',
    'system('
  ];

  for (const pattern of suspiciousPatterns) {
    if (content.toLowerCase().includes(pattern)) {
      return { clean: false, reason: `Suspicious code injection pattern detected: "${pattern}"` };
    }
  }

  return { clean: true };
}

/**
 * POST /api/media/upload/vehicle - Public vehicle listing photos upload
 * 
 * Takes an array of base64 strings or a single base64 string, processes it,
 * uploads to the public 'vehicle-images' bucket, and returns public WebP/JPEG URLs.
 */
router.post('/upload/vehicle', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  const { images, vin } = req.body;

  if (!images || !vin) {
    return res.status(400).json({ error: 'Missing mandatory parameters: images, vin' });
  }

  const imageList = Array.isArray(images) ? images : [images];
  if (imageList.length > 15) {
    return res.status(400).json({ error: 'Too many images: maximum 15 per upload.' });
  }

  // Uploads may target either an existing vehicle (the caller must own it or share
  // its tenant) or a VIN that is still being created by this authenticated caller.
  // A VIN owned by someone else is never writable.
  if (req.userContext?.role !== 'admin') {
    const { data: vehicleRow, error: vehicleErr } = await supabase
      .from('vehicles')
      .select('owner_id, tenant_id')
      .eq('vin', String(vin).toUpperCase())
      .maybeSingle();
    if (vehicleErr) {
      return res.status(500).json({ error: 'Vehicle ownership lookup failed.' });
    }
    if (vehicleRow) {
      const ownsVehicle = vehicleRow.owner_id && vehicleRow.owner_id === req.userContext?.id;
      const sameTenant = vehicleRow.tenant_id && vehicleRow.tenant_id === req.userContext?.tenantId;
      if (!ownsVehicle && !sameTenant) {
        await logAuditEvent(supabase, {
          req,
          event_type: 'SECURITY_MEDIA_UPLOAD_DENIED',
          vin,
          reason: 'Authenticated caller attempted image upload for a vehicle they neither own nor share a tenant with.'
        }).catch(() => {});
        return res.status(403).json({ error: 'You are not authorized to upload media for this vehicle.' });
      }
    }
  }

  const uploadedUrls = [];

  console.log(`📸 [Media Router] Processing upload for ${imageList.length} vehicle image(s) for VIN: [${vin}]`);

  try {
    for (let idx = 0; idx < imageList.length; idx++) {
      const base64Str = imageList[idx];
      const { mimeType, fileBuffer } = parseBase64Payload(base64Str);

      // Enforce file size limit
      if (fileBuffer.length > MAX_UPLOAD_SIZE) {
        return res.status(400).json({ error: `File size exceeds policy limit of 10MB.` });
      }

      // Check MIME spoofing
      if (!verifyMimeMagicBytes(fileBuffer, mimeType)) {
        await logAuditEvent(supabase, {
          req,
          event_type: 'SECURITY_MIME_SPOOFING_DETECTED',
          vin,
          reason: `MIME spoofing blocked. File claims to be ${mimeType} but magic bytes do not match.`
        }).catch(() => {});
        return res.status(400).json({ error: `MIME verification failed. File structure does not match ${mimeType}.` });
      }

      // Malware scan
      const scanResult = scanForMalware(fileBuffer);
      if (!scanResult.clean) {
        await logAuditEvent(supabase, {
          req,
          event_type: 'SECURITY_MALWARE_DETECTED',
          vin,
          reason: `Upload rejected due to malware detection: ${scanResult.reason}`
        }).catch(() => {});
        return res.status(400).json({ error: `Malware scan failed: ${scanResult.reason}` });
      }

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
  // The actor is the authenticated session identity — never the spoofable
  // x-user-id header.
  const userId = req.userContext?.id || 'system';

  if (!document || !docType || !vin) {
    return res.status(400).json({ error: 'Missing mandatory parameters: document, docType, vin' });
  }

  // Same ownership rule as /upload/vehicle: documents may target an existing
  // vehicle (the caller must own it or share its tenant) or a VIN that is still
  // being created by this authenticated caller (row-absent => allowed). A VIN
  // owned by someone else is never writable.
  if (req.userContext?.role !== 'admin') {
    const { data: vehicleRow, error: vehicleErr } = await supabase
      .from('vehicles')
      .select('owner_id, tenant_id')
      .eq('vin', String(vin).toUpperCase())
      .maybeSingle();
    if (vehicleErr) {
      return res.status(500).json({ error: 'Vehicle ownership lookup failed.' });
    }
    if (vehicleRow) {
      const ownsVehicle = vehicleRow.owner_id && vehicleRow.owner_id === req.userContext?.id;
      const sameTenant = vehicleRow.tenant_id && vehicleRow.tenant_id === req.userContext?.tenantId;
      if (!ownsVehicle && !sameTenant) {
        await logAuditEvent(supabase, {
          req,
          event_type: 'SECURITY_MEDIA_UPLOAD_DENIED',
          vin,
          reason: 'Authenticated caller attempted document upload for a vehicle they neither own nor share a tenant with.'
        }).catch(() => {});
        return res.status(403).json({ error: 'You are not authorized to upload documents for this vehicle.' });
      }
    }
  }

  console.log(`📄 [Media Router] Uploading secure [${docType}] for VIN: [${vin}] by user: [${userId}]`);

  try {
    const { mimeType, fileBuffer } = parseBase64Payload(document);

    // Enforce file size limit
    if (fileBuffer.length > MAX_UPLOAD_SIZE) {
      return res.status(400).json({ error: `File size exceeds policy limit of 10MB.` });
    }

    // Check MIME spoofing
    if (!verifyMimeMagicBytes(fileBuffer, mimeType)) {
      await logAuditEvent(supabase, {
        req,
        event_type: 'SECURITY_MIME_SPOOFING_DETECTED',
        vin,
        reason: `MIME spoofing blocked. Document claims to be ${mimeType} but magic bytes do not match.`
      }).catch(() => {});
      return res.status(400).json({ error: `MIME verification failed. File structure does not match ${mimeType}.` });
    }

    // Malware scan
    const scanResult = scanForMalware(fileBuffer);
    if (!scanResult.clean) {
      await logAuditEvent(supabase, {
        req,
        event_type: 'SECURITY_MALWARE_DETECTED',
        vin,
        reason: `Upload rejected due to malware detection: ${scanResult.reason}`
      }).catch(() => {});
      return res.status(400).json({ error: `Malware scan failed: ${scanResult.reason}` });
    }

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
 * GET /api/media/upload/signed-url
 * 
 * Scoped and audited signed upload URL generator.
 * Only allowed for authenticated owner, dealer, or admin roles.
 */
router.get('/upload/signed-url', authorizeRole(['owner', 'dealer', 'admin']), async (req, res) => {
  const { bucket, vin, fileName, fileType, fileSize } = req.query;

  if (!bucket || !vin || !fileName || !fileType || !fileSize) {
    return res.status(400).json({ error: 'Missing mandatory parameters: bucket, vin, fileName, fileType, fileSize' });
  }

  // 1. Strict bucket validation
  const allowedBuckets = ['vehicle-images', 'ocr-documents'];
  if (!allowedBuckets.includes(bucket)) {
    return res.status(400).json({ error: 'Forbidden. Invalid upload bucket.' });
  }

  // 2. Strict path prefix validation: must start with VIN (uppercase, 17 characters alphanumeric)
  const cleanVin = vin.trim().toUpperCase();
  if (!/^[A-Z0-9]{17}$/.test(cleanVin)) {
    return res.status(400).json({ error: 'Invalid VIN format. Must be exactly 17 alphanumeric characters.' });
  }

  // Clean filename to prevent path traversal
  const cleanFileName = path.basename(fileName).replace(/[^a-zA-Z0-9_.-]/g, '');
  const destinationPath = `${cleanVin}/${cleanFileName}`;

  // 3. Strict file type and size policy validation
  const sizeLimit = bucket === 'ocr-documents' ? 5 * 1024 * 1024 : 10 * 1024 * 1024; // 5MB for docs, 10MB for images
  const sizeNum = Number(fileSize);
  if (isNaN(sizeNum) || sizeNum <= 0 || sizeNum > sizeLimit) {
    return res.status(400).json({ error: `File size exceeds allowed policy limit of ${sizeLimit / (1024 * 1024)}MB.` });
  }

  const allowedTypes = bucket === 'ocr-documents'
    ? ['application/pdf', 'image/jpeg', 'image/png']
    : ['image/jpeg', 'image/jpg', 'image/png'];
  if (!allowedTypes.includes(fileType)) {
    return res.status(400).json({ error: `File type ${fileType} is not allowed for bucket ${bucket}.` });
  }

  // 4. VIN ownership: a signed upload URL is a write grant, so a non-admin must
  // own the VIN or share its tenant — same rule as /upload/vehicle (row-absent
  // => allowed for creation flows; someone else's VIN is never writable).
  if (req.userContext?.role !== 'admin') {
    const { data: vehicleRow, error: vehicleErr } = await supabase
      .from('vehicles')
      .select('owner_id, tenant_id')
      .eq('vin', cleanVin)
      .maybeSingle();
    if (vehicleErr) {
      return res.status(500).json({ error: 'Vehicle ownership lookup failed.' });
    }
    if (vehicleRow) {
      const ownsVehicle = vehicleRow.owner_id && vehicleRow.owner_id === req.userContext?.id;
      const sameTenant = vehicleRow.tenant_id && vehicleRow.tenant_id === req.userContext?.tenantId;
      if (!ownsVehicle && !sameTenant) {
        await logAuditEvent(supabase, {
          req,
          event_type: 'SECURITY_MEDIA_UPLOAD_DENIED',
          vin: cleanVin,
          reason: 'Authenticated caller requested a signed upload URL for a vehicle they neither own nor share a tenant with.'
        }).catch(() => {});
        return res.status(403).json({ error: 'You are not authorized to upload media for this vehicle.' });
      }
    }
  }

  try {
    // Generate secure upload URL with short expiry (e.g., 300 seconds)
    const { signedUrl, token } = await generateSecureUploadUrl(bucket, destinationPath, 300);

    // Audit trace logging
    await logAuditEvent(supabase, {
      req,
      event_type: 'SECURITY_SIGNED_UPLOAD_URL_GENERATED',
      vin: cleanVin,
      reason: `Generated temporary signed upload URL for ${bucket}/${destinationPath}`,
      metadata: {
        bucket,
        destinationPath,
        fileType,
        fileSize: sizeNum,
        expiresIn: 300
      }
    });

    res.json({ signedUrl, token, path: destinationPath });
  } catch (err) {
    console.error('❌ [Media Router] Signed upload URL generation failed:', err.message);
    res.status(500).json({ error: 'Failed to generate secure upload policy.' });
  }
});

/**
 * GET /api/media/document/signed-url - Retrieve a timed read token for a private document
 */
router.get('/document/signed-url', authorizeRole(['admin', 'government', 'owner']), async (req, res) => {
  const { path: docPath } = req.query;

  if (!docPath) {
    return res.status(400).json({ error: 'Missing mandatory query parameter: path' });
  }

  // Documents live under a <VIN>/ prefix. Signing an arbitrary caller-supplied
  // path was an IDOR against the private ocr-documents bucket: enforce the VIN
  // prefix shape and reject traversal before any signing happens.
  const cleanPath = String(docPath);
  const vinPrefixMatch = /^([A-Z0-9]{17})\//.exec(cleanPath);
  if (cleanPath.includes('..') || cleanPath.startsWith('/') || !vinPrefixMatch) {
    return res.status(400).json({ error: 'Invalid document path. Must be scoped under a 17-character VIN prefix.' });
  }
  const pathVin = vinPrefixMatch[1];

  // Admin/government read globally; owner/dealer sessions may only read
  // documents for a VIN they own or that belongs to their tenant.
  if (req.userContext?.role === 'owner' || req.userContext?.role === 'dealer') {
    const { data: vehicleRow, error: vehicleErr } = await supabase
      .from('vehicles')
      .select('owner_id, tenant_id')
      .eq('vin', pathVin)
      .maybeSingle();
    if (vehicleErr) {
      return res.status(500).json({ error: 'Vehicle ownership lookup failed.' });
    }
    const ownsVehicle = vehicleRow?.owner_id && vehicleRow.owner_id === req.userContext?.id;
    const sameTenant = vehicleRow?.tenant_id && vehicleRow.tenant_id === req.userContext?.tenantId;
    if (!ownsVehicle && !sameTenant) {
      await logAuditEvent(supabase, {
        req,
        event_type: 'SECURITY_DOCUMENT_READ_DENIED',
        vin: pathVin,
        reason: 'Authenticated caller requested a signed read URL for a document under a VIN they neither own nor share a tenant with.'
      }).catch(() => {});
      return res.status(403).json({ error: 'You are not authorized to read documents for this vehicle.' });
    }
  }

  try {
    const signedUrl = await generateSecureReadUrl('ocr-documents', cleanPath, 3600); // Expires in 1 hour
    res.json({ signedUrl });
  } catch (err) {
    console.error('❌ [Media Router] Signed URL generation failed:', err.message);
    res.status(500).json({ error: 'Failed to authorize and retrieve secure document' });
  }
});

export default router;
