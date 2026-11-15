/**
 * RX03-P1A-R2 — a decorative arc for a PUBLISHED canonical trust score (0–100).
 *
 * The page renders this only beside a score the trust authority published, and the number itself is
 * always printed next to it as text; the arc adds no information and is hidden from assistive
 * technology. It never stands in for a missing score: there is no "empty ring" state.
 */
export function ScoreRing({ value, className = '' }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value))
  const radius = 22
  const circumference = 2 * Math.PI * radius
  return (
    <svg viewBox="0 0 56 56" className={className} aria-hidden="true" focusable="false">
      <circle cx="28" cy="28" r={radius} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth="6" />
      <circle
        cx="28"
        cy="28"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        transform="rotate(-90 28 28)"
      />
    </svg>
  )
}
