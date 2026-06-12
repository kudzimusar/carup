function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeWorkbookBatchMetadata(metadata) {
  return isPlainObject(metadata) ? { ...metadata } : {};
}

export function normalizeOperatorHold(metadataOrHold) {
  const candidate = isPlainObject(metadataOrHold?.operatorHold)
    ? metadataOrHold.operatorHold
    : metadataOrHold;
  if (!isPlainObject(candidate)) return null;

  const active = candidate.active === true;
  return {
    ...candidate,
    active,
    reason: typeof candidate.reason === 'string' ? candidate.reason : null,
  };
}

export function normalizeOperatorNotes(metadataOrNotes) {
  const candidate = Array.isArray(metadataOrNotes?.operatorNotes)
    ? metadataOrNotes.operatorNotes
    : metadataOrNotes;
  if (!Array.isArray(candidate)) return [];

  return candidate
    .filter(isPlainObject)
    .map((note) => ({
      ...note,
      note: typeof note.note === 'string' ? note.note : '',
      visibility: note.visibility || 'internal',
    }));
}

export function normalizeStatusTimeline(metadataOrTimeline) {
  const candidate = Array.isArray(metadataOrTimeline?.statusTimeline)
    ? metadataOrTimeline.statusTimeline
    : metadataOrTimeline;
  return Array.isArray(candidate) ? candidate.filter(isPlainObject) : [];
}

export function safeGetImportResult(row = {}) {
  const result = row.import_result || row.importResult;
  return isPlainObject(result) ? result : {};
}
