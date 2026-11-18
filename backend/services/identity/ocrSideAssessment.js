function fieldEntries(data = {}) {
  const { additional_fields: additional, ...top } = data;
  return { ...additional, ...top };
}

function comparisonValue(field, value) {
  const text = String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toUpperCase();
  return field.endsWith('_number') ? text.replace(/[\s-]/gu, '') : text;
}

export function combineOcrSides(front, back) {
  const fieldSources = {};
  const conflicts = [];
  const sideStatus = result => result.success
    ? Object.keys(fieldEntries(result.extractedData)).length ? 'extracted' : 'no_fields'
    : 'failed';
  const assessment = {
    front: sideStatus(front),
    back: back ? sideStatus(back) : 'not_applicable',
    comparison: back ? 'uncompared' : 'not_applicable',
    conflictingFields: conflicts,
    fieldSources,
  };

  if (!front.success || (back && !back.success)) {
    return { ...(!front.success ? front : back), sideAssessment: assessment };
  }

  const frontFields = fieldEntries(front.extractedData);
  const backFields = back ? fieldEntries(back.extractedData) : {};
  let compared = false;
  for (const field of new Set([...Object.keys(frontFields), ...Object.keys(backFields)])) {
    const onFront = Object.hasOwn(frontFields, field);
    const onBack = Object.hasOwn(backFields, field);
    fieldSources[field] = onFront && onBack ? ['front', 'back'] : [onFront ? 'front' : 'back'];
    if (onFront && onBack) {
      compared = true;
      if (comparisonValue(field, frontFields[field]) !== comparisonValue(field, backFields[field])) conflicts.push(field);
    }
  }

  if (compared) assessment.comparison = conflicts.length ? 'conflict' : 'consistent_overlap';
  if (conflicts.length) return { ...front, success: false, error: 'DOCUMENT_SIDE_MISMATCH', extractedData: {}, sideAssessment: assessment };

  const extractedData = { ...back?.extractedData, ...front.extractedData };
  if (back?.extractedData.additional_fields || front.extractedData.additional_fields) {
    extractedData.additional_fields = { ...back?.extractedData.additional_fields, ...front.extractedData.additional_fields };
  }
  return { ...front, extractedData, sideAssessment: assessment };
}
