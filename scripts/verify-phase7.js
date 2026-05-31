import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

// Define connection constants
const API_URL = 'http://localhost:5001/api';

async function runTests() {
  console.log('🏁 Starting Phase 7: Automated Media Pipeline & Storage Verifications...\n');

  try {
    // Dynamically load the stripJpegExif function after dotenv variables are populated
    const { stripJpegExif } = await import('../backend/services/storage/storageService.js');

    // ==========================================
    // UNIT TEST 1: JPEG EXIF Metadata Stripping
    // ==========================================
    console.log('🧪 Running Unit Test: Pure-JS JPEG EXIF Metadata Stripping...');
    
    // Construct dummy binary buffer mimicking a JPEG structure
    // SOI: 0xFF, 0xD8
    // APP1 Segment: 0xFF, 0xE1, 0x00, 0x08, 'E', 'x', 'i', 'f', 0x00, 0x00
    // APP0 Segment: 0xFF, 0xE0, 0x00, 0x06, 0xAA, 0xBB, 0xCC, 0xDD
    // SOS Segment: 0xFF, 0xDA, 0x99, 0x88, 0x77
    const dummyJpegBuffer = Buffer.concat([
      Buffer.from([0xFF, 0xD8]), // SOI
      Buffer.from([0xFF, 0xE1, 0x00, 0x08]), // APP1 marker + 8 bytes segment length (2 bytes length + 6 bytes payload)
      Buffer.from('Exif\0\0', 'ascii'), // APP1 content (6 bytes)
      Buffer.from([0xFF, 0xE0, 0x00, 0x06, 0xAA, 0xBB, 0xCC, 0xDD]), // APP0
      Buffer.from([0xFF, 0xDA, 0x99, 0x88, 0x77]) // SOS (Start of Scan)
    ]);

    const strippedBuffer = stripJpegExif(dummyJpegBuffer);
    
    // The stripped buffer must NOT contain the APP1 marker (0xFFE1) but must keep SOI, APP0 and SOS
    const app1Index = strippedBuffer.indexOf(Buffer.from([0xFF, 0xE1]));
    const app0Index = strippedBuffer.indexOf(Buffer.from([0xFF, 0xE0]));
    const sosIndex = strippedBuffer.indexOf(Buffer.from([0xFF, 0xDA]));

    if (app1Index !== -1) {
      throw new Error('Failure: APP1 EXIF segment was not stripped from JPEG buffer!');
    }
    if (app0Index === -1 || sosIndex === -1) {
      throw new Error('Failure: Valid image segments (APP0 or SOS) were accidentally lost during EXIF stripping!');
    }
    
    console.log('✅ Unit Test Passed: Pure-JS JPEG EXIF metadata successfully identified and stripped!\n');


    // ==========================================
    // E2E TEST 2: Public Vehicle Image Uploading
    // ==========================================
    console.log('📸 Running E2E Test: Public Vehicle Image Upload to `/api/media/upload/vehicle`...');
    
    // 1x1 Red Pixel PNG base64 representation
    const dummyBase64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const testVin = 'VIN74329849204928';

    const vehicleUploadRes = await fetch(`${API_URL}/media/upload/vehicle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: [dummyBase64Image],
        vin: testVin
      })
    });

    if (!vehicleUploadRes.ok) {
      throw new Error(`Public upload request failed: ${await vehicleUploadRes.text()}`);
    }

    const vehicleUploadData = await vehicleUploadRes.json();
    if (!vehicleUploadData.urls || vehicleUploadData.urls.length === 0) {
      throw new Error('Public upload response does not contain any image URLs!');
    }

    console.log('✅ E2E Test Passed: Public vehicle listing image processed and uploaded.');
    console.log(`   Public URL: ${vehicleUploadData.urls[0]}\n`);


    // ==========================================
    // E2E TEST 3: Secure KYC Document Uploading
    // ==========================================
    console.log('📄 Running E2E Test: Private KYC Document Upload to `/api/media/upload/document`...');
    
    // Tiny dummy PDF base64
    const dummyBase64Doc = 'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iagogIDw8IC9UeXBlIC9DYXRhbG9nCiAgICAgL1BhZ2VzIDIgMCBSCgogID4+CmVuZG9iagoyIDAgb2JqagogIDw8IC9UeXBlIC9QYWdlcwogICAgIC9LaWRzIFszIDAgUl0KICAgICAvQ291bnQgMQogID4+CmVuZG9iagozIDAgb2JqagogIDw8IC9UeXBlIC9QYWdlCiAgICAgL1BhcmVudCAyIDAgUgogICAgIC9SZXNvdXJjZXMgPDw+PgogICAgIC9NZWRpYUJveCBbMCAwIDU5NSA4NDJdCiAgPj4KZW5kb2JqCnRyYWlsZXIKICA8PCAvUm9vdCAxIDAgUgo+PgpFT0Y=';

    const docUploadRes = await fetch(`${API_URL}/media/upload/document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'u1',
        'x-stakeholder-role': 'owner'
      },
      body: JSON.stringify({
        document: dummyBase64Doc,
        docType: 'national-id',
        vin: 'KYC-VERIFY-123'
      })
    });

    if (!docUploadRes.ok) {
      throw new Error(`Private document upload failed: ${await docUploadRes.text()}`);
    }

    const docUploadData = await docUploadRes.json();
    if (!docUploadData.storagePath) {
      throw new Error('Private upload response does not contain secure storagePath!');
    }

    console.log('✅ E2E Test Passed: Private identity document successfully secured under RLS path.');
    console.log(`   Secure Storage Path: ${docUploadData.storagePath}\n`);


    // ==========================================
    // E2E TEST 4: Secure Timed SAS URL Generation
    // ==========================================
    console.log('🔑 Running E2E Test: Timed Signed Read URL Generation...');
    
    const signedUrlRes = await fetch(`${API_URL}/media/document/signed-url?path=${encodeURIComponent(docUploadData.storagePath)}`, {
      method: 'GET',
      headers: {
        'x-user-id': 'u1',
        'x-stakeholder-role': 'owner'
      }
    });

    if (!signedUrlRes.ok) {
      throw new Error(`Signed URL retrieval failed: ${await signedUrlRes.text()}`);
    }

    const signedUrlData = await signedUrlRes.json();
    if (!signedUrlData.signedUrl) {
      throw new Error('Signed URL response does not contain signedUrl!');
    }

    console.log('✅ E2E Test Passed: Secure timed read signature generated dynamically.');
    console.log(`   Temporary Signed URL: ${signedUrlData.signedUrl.substring(0, 120)}...\n`);


    console.log('🎉 🎉 ALL PHASE 7 Enterprise Object Storage & Media Pipeline Verifications Passed Successfully! (Exit 0)');
    process.exit(0);

  } catch (err) {
    console.error('❌ Phase 7 Verification Failed:', err.message || err);
    process.exit(1);
  }
}

runTests();
