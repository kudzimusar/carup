export const ZIMBABWE_REGISTRATION_OPTIONS = [
  { value: 'import_in_transit', label: 'Import in transit' },
  { value: 'arrived_customs_pending', label: 'Arrived — Zimbabwe customs pending' },
  { value: 'customs_cleared_cvr_pending', label: 'Customs cleared — local registration pending' },
  { value: 'cvr_plate_pending', label: 'CVR processing — plate pending' },
  { value: 'locally_registered', label: 'Locally registered in Zimbabwe' },
  { value: 'reregistration_pending', label: 'Re-registration pending' },
  { value: 'temporary_foreign_tip', label: 'Temporary foreign vehicle — TIP' },
  { value: 'unknown', label: 'Registration stage not yet established' },
] as const

export type ZimbabweRegistrationStatus = (typeof ZIMBABWE_REGISTRATION_OPTIONS)[number]['value']

const labels = Object.fromEntries(
  ZIMBABWE_REGISTRATION_OPTIONS.map(option => [option.value, option.label]),
) as Record<string, string>

export function normalizeSellerRegistrationStatus(value: unknown): ZimbabweRegistrationStatus | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (raw in labels) return raw as ZimbabweRegistrationStatus
  if (raw === 'local') return 'locally_registered'
  // The old "Imported / Foreign-registered" choice was too broad to recover an exact stage.
  if (raw === 'imported' || raw === 'current') return 'unknown'
  return null
}

export function registrationLabel(value: unknown) {
  const normalized = normalizeSellerRegistrationStatus(value)
  return normalized ? labels[normalized] : 'Not recorded'
}
