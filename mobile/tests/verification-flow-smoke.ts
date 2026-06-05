/**
 * Verification Flow Smoke Test
 * Tests the actual runtime behavior of the verification flow modules.
 * Run with: npx tsx tests/verification-flow-smoke.ts
 */

import { useVerificationStore } from '../store/verificationStore';
import { simulateCapture } from '../utils/debugCapture';

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

function test(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`  [${icon}] ${name}: ${detail}`);
}

async function runTests() {
  console.log('\n=== PHASE 7A VERIFICATION FLOW SMOKE TEST ===\n');

  // --- Test 1: Store initialization ---
  console.log('1. Store initialization');
  const store = useVerificationStore.getState();
  test('Store exists', !!store, typeof store);
  test('capturedFront initially null', store.capturedFront === null, String(store.capturedFront));
  test('capturedBack initially null', store.capturedBack === null, String(store.capturedBack));
  test('capturedSelfie initially null', store.capturedSelfie === null, String(store.capturedSelfie));
  test('ocrResult initially null', store.ocrResult === null, String(store.ocrResult));
  test('processingError initially null', store.processingError === null, String(store.processingError));

  // --- Test 2: hasRequiredImages validation ---
  console.log('\n2. hasRequiredImages validation');
  test('No images → false', !store.hasRequiredImages(true), 'doubleSided=true, no images');
  test('No images single → false', !store.hasRequiredImages(false), 'doubleSided=false, no images');

  // --- Test 3: Simulated capture ---
  console.log('\n3. Simulated capture (debugCapture)');
  const asset = await simulateCapture();
  test('simulateCapture returns asset', !!asset, asset ? `${asset.width}x${asset.height}` : 'null');
  test('Asset has base64', !!asset?.base64, asset?.base64?.substring(0, 20) + '...');
  test('Asset has dataUri', !!asset?.dataUri, asset?.dataUri?.substring(0, 30) + '...');
  test('Asset has uri', !!asset?.uri, asset?.uri?.substring(0, 30) + '...');
  test('Asset mimeType is image/png', asset?.mimeType === 'image/png', String(asset?.mimeType));
  test('Asset fileSizeBytes > 0', (asset?.fileSizeBytes ?? 0) > 0, String(asset?.fileSizeBytes));

  // --- Test 4: Store mutations ---
  console.log('\n4. Store mutations');
  store.setCapturedFront(asset!.dataUri);
  test('setCapturedFront works', useVerificationStore.getState().capturedFront === asset!.dataUri, 'stored');

  store.setCapturedBack(asset!.dataUri);
  test('setCapturedBack works', useVerificationStore.getState().capturedBack === asset!.dataUri, 'stored');

  store.setCapturedSelfie(asset!.dataUri);
  test('setCapturedSelfie works', useVerificationStore.getState().capturedSelfie === asset!.dataUri, 'stored');

  // --- Test 5: hasRequiredImages with data ---
  console.log('\n5. hasRequiredImages with data');
  test('All images doubleSided=true → true', useVerificationStore.getState().hasRequiredImages(true), 'all present');
  test('All images doubleSided=false → true', useVerificationStore.getState().hasRequiredImages(false), 'all present');

  // --- Test 6: Missing back for double-sided ---
  console.log('\n6. Missing back validation');
  store.setCapturedBack(null as any);
  test('Missing back doubleSided=true → false', !useVerificationStore.getState().hasRequiredImages(true), 'back is null');
  test('Missing back doubleSided=false → true', useVerificationStore.getState().hasRequiredImages(false), 'single-sided ignores back');

  // Restore back
  store.setCapturedBack(asset!.dataUri);

  // --- Test 7: OCR result storage ---
  console.log('\n7. OCR result storage');
  const mockOcr = { first_name: 'Tinashe', last_name: 'Moyo', national_id_number: '29-198427-G-45', country: 'Zimbabwe' };
  store.setOcrResult(mockOcr);
  test('setOcrResult works', useVerificationStore.getState().ocrResult?.first_name === 'Tinashe', JSON.stringify(useVerificationStore.getState().ocrResult));

  // --- Test 8: Processing error storage ---
  console.log('\n8. Processing error storage');
  store.setProcessingError('Backend unreachable. Using offline verification.');
  test('setProcessingError works', useVerificationStore.getState().processingError?.includes('unreachable') ?? false, String(useVerificationStore.getState().processingError));

  // --- Test 9: Store clear ---
  console.log('\n9. Store clear');
  store.clear();
  const cleared = useVerificationStore.getState();
  test('clear resets capturedFront', cleared.capturedFront === null, String(cleared.capturedFront));
  test('clear resets capturedBack', cleared.capturedBack === null, String(cleared.capturedBack));
  test('clear resets capturedSelfie', cleared.capturedSelfie === null, String(cleared.capturedSelfie));
  test('clear resets ocrResult', cleared.ocrResult === null, String(cleared.ocrResult));
  test('clear resets processingError', cleared.processingError === null, String(cleared.processingError));
  test('hasRequiredImages after clear → false', !cleared.hasRequiredImages(true), 'all cleared');

  // --- Test 10: Double-sided flow simulation ---
  console.log('\n10. Double-sided flow simulation (Zimbabwe National ID)');
  const s = useVerificationStore.getState();
  // Step 1: document-select clears store (already cleared above)
  s.clear();
  test('Step 1: Store cleared', !useVerificationStore.getState().capturedFront, 'ready for new flow');

  // Step 2: capture-front
  const frontAsset = await simulateCapture();
  useVerificationStore.getState().setCapturedFront(frontAsset!.dataUri);
  test('Step 2: Front captured', !!useVerificationStore.getState().capturedFront, 'simulated');

  // Step 3: capture-back (double-sided)
  const backAsset = await simulateCapture();
  useVerificationStore.getState().setCapturedBack(backAsset!.dataUri);
  test('Step 3: Back captured', !!useVerificationStore.getState().capturedBack, 'simulated');

  // Step 4: selfie
  const selfieAsset = await simulateCapture();
  useVerificationStore.getState().setCapturedSelfie(selfieAsset!.dataUri);
  test('Step 4: Selfie captured', !!useVerificationStore.getState().capturedSelfie, 'simulated');

  // Step 5: hasRequiredImages
  test('Step 5: All required images present', useVerificationStore.getState().hasRequiredImages(true), 'double-sided complete');

  // Step 6: Processing (simulate backend failure)
  test('Step 6: Processing can proceed', useVerificationStore.getState().hasRequiredImages(true), 'ready for OCR');

  // Step 7: Store clear after completion
  useVerificationStore.getState().clear();
  test('Step 7: Store cleared after completion', !useVerificationStore.getState().capturedFront, 'clean');

  // --- Test 11: Single-sided flow simulation (Passport) ---
  console.log('\n11. Single-sided flow simulation (Passport)');
  useVerificationStore.getState().clear();
  const sFront = await simulateCapture();
  useVerificationStore.getState().setCapturedFront(sFront!.dataUri);
  test('Step 1: Front captured', !!useVerificationStore.getState().capturedFront, 'simulated');

  // No back capture for single-sided
  test('Step 2: No back needed', !useVerificationStore.getState().capturedBack, 'single-sided');

  const sSelfie = await simulateCapture();
  useVerificationStore.getState().setCapturedSelfie(sSelfie!.dataUri);
  test('Step 3: Selfie captured', !!useVerificationStore.getState().capturedSelfie, 'simulated');

  test('Step 4: All required images (single-sided)', useVerificationStore.getState().hasRequiredImages(false), 'passport flow');
  test('Step 5: All required images would fail for double-sided', !useVerificationStore.getState().hasRequiredImages(true), 'no back image');

  useVerificationStore.getState().clear();

  // --- Summary ---
  console.log('\n=== RESULTS ===');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n  FAILED TESTS:');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`    - ${r.name}: ${r.detail}`);
    });
    process.exit(1);
  } else {
    console.log('\n  ALL TESTS PASSED');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
