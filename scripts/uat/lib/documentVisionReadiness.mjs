/**
 * The document-vision readiness rule, in one place both the harness and its tests can run.
 *
 * It lived inline in the harness, where the only way to test it was to grep the script for the
 * word "mockPermitted" — an assertion that stayed green when the guard was disabled, because the
 * word was still there. A rule worth enforcing has to be executable by the thing that checks it.
 */
export function assertDocumentVisionReady(health) {
  const dv = health?.documentVision;
  if (!dv) {
    throw new Error('backend does not report documentVision readiness — deploy a build that does');
  }
  if (dv.mockPermitted) {
    throw new Error('this deployment permits MOCK OCR; a live certification must not run against it');
  }
  if (!dv.configured) {
    throw new Error(
      `document-vision provider "${dv.provider}" (${dv.model}) is NOT configured`
      + ` — requires ${(dv.requires || []).join(', ')}`,
    );
  }
  return { id: dv.provider, model: dv.model };
}
