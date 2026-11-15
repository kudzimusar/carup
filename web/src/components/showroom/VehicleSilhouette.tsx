/**
 * RX03-P1a — original line-art vehicle profiles, one per canonical body style.
 *
 * Drawn for CarUp (no manufacturer shapes, badges or grilles), so they can stand in where a
 * photograph would otherwise be invented: the body-style rail on Home and the O-6 studio plate
 * when a listing has no usable seller photo. The roofline segment is drawn separately so it can
 * carry the Option 5 orange — the same idea as the brand's roofline mark.
 */
import { useId } from 'react'

type Profile = { body: string; roof: string; wheels: [number, number]; r: number }

const PROFILES: Record<string, Profile> = {
  sedan: {
    body: 'M14 70 L14 58 Q16 53 30 51 L64 46 L84 34 Q90 31 100 31 L136 31 Q146 31 154 37 L172 50 L212 55 Q224 57 226 64 L226 70',
    roof: 'M64 46 L84 34 Q90 31 100 31 L136 31 Q146 31 154 37 L172 50',
    wheels: [60, 182],
    r: 13,
  },
  hatchback: {
    body: 'M34 70 L34 50 Q36 44 44 36 L52 31 Q56 29 64 29 L122 29 Q132 29 140 36 L160 50 L192 55 Q204 58 206 64 L206 70',
    roof: 'M44 36 L52 31 Q56 29 64 29 L122 29 Q132 29 140 36 L160 50',
    wheels: [68, 174],
    r: 13,
  },
  suv: {
    body: 'M12 70 L12 44 Q13 37 20 32 L28 26 Q32 23 40 23 L148 23 Q156 23 162 28 L180 42 L216 47 Q226 50 227 60 L227 70',
    roof: 'M28 26 Q32 23 40 23 L148 23 Q156 23 162 28 L180 42',
    wheels: [62, 184],
    r: 16,
  },
  crossover: {
    body: 'M16 70 L16 50 Q18 42 26 37 L44 28 Q50 25 60 25 L140 25 Q150 25 158 31 L176 45 L212 51 Q224 54 225 62 L225 70',
    roof: 'M44 28 Q50 25 60 25 L140 25 Q150 25 158 31 L176 45',
    wheels: [62, 182],
    r: 15,
  },
  pickup: {
    body: 'M10 70 L10 47 L98 47 L100 32 Q101 27 108 27 L148 27 Q156 27 162 32 L176 44 L214 49 Q225 52 226 61 L226 70',
    roof: 'M100 32 Q101 27 108 27 L148 27 Q156 27 162 32 L176 44',
    wheels: [54, 186],
    r: 16,
  },
  van: {
    body: 'M12 70 L12 30 Q12 22 22 22 L166 22 Q174 22 180 28 L196 44 L218 50 Q226 53 226 61 L226 70',
    roof: 'M12 30 Q12 22 22 22 L166 22 Q174 22 180 28 L196 44',
    wheels: [56, 186],
    r: 15,
  },
  coupe: {
    body: 'M16 70 L16 59 Q18 53 34 51 L76 44 L100 33 Q106 30 116 30 L134 30 Q144 30 152 36 L172 50 L212 55 Q223 58 224 65 L224 70',
    roof: 'M76 44 L100 33 Q106 30 116 30 L134 30 Q144 30 152 36 L172 50',
    wheels: [62, 182],
    r: 13,
  },
}

const ALIASES: Record<string, keyof typeof PROFILES> = {
  sedan: 'sedan',
  saloon: 'sedan',
  hatchback: 'hatchback',
  hatch: 'hatchback',
  suv: 'suv',
  crossover: 'crossover',
  pickup: 'pickup',
  'pick-up': 'pickup',
  truck: 'pickup',
  'chassis cab': 'pickup',
  commercial: 'van',
  van: 'van',
  minibus: 'van',
  bus: 'van',
  mpv: 'van',
  wagon: 'crossover',
  coupe: 'coupe',
  convertible: 'coupe',
}

export function silhouetteKey(bodyStyle: string | null | undefined): keyof typeof PROFILES {
  const key = (bodyStyle || '').trim().toLowerCase()
  return ALIASES[key] ?? 'sedan'
}

interface VehicleSilhouetteProps {
  bodyStyle?: string | null
  className?: string
  /** Stroke colour of the body and wheels. */
  tone?: 'ink' | 'paper' | 'muted'
  /** Draw the roofline in the Option 5 orange. */
  accent?: boolean
  strokeWidth?: number
}

const TONES = { ink: '#09122A', paper: '#F8FAFC', muted: '#94A3B8' }

export function VehicleSilhouette({ bodyStyle, className, tone = 'ink', accent = true, strokeWidth = 2.25 }: VehicleSilhouetteProps) {
  const profile = PROFILES[silhouetteKey(bodyStyle)]
  const stroke = TONES[tone]
  const [rear, front] = profile.wheels
  const gradientId = `carup-roofline-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 240 96" className={className} aria-hidden="true" focusable="false" fill="none">
      <path d={profile.body} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {/* Ground line with gaps for the wheels. */}
      <path
        d={`M6 84 H${rear - profile.r - 4} M${rear + profile.r + 4} 84 H${front - profile.r - 4} M${front + profile.r + 4} 84 H234`}
        stroke={stroke}
        strokeOpacity={0.28}
        strokeWidth={strokeWidth * 0.6}
        strokeLinecap="round"
      />
      {[rear, front].map(x => (
        <g key={x}>
          <circle cx={x} cy={84 - profile.r} r={profile.r} stroke={stroke} strokeWidth={strokeWidth} />
          <circle cx={x} cy={84 - profile.r} r={profile.r * 0.38} stroke={stroke} strokeOpacity={0.55} strokeWidth={strokeWidth * 0.7} />
        </g>
      ))}
      {accent && (
        <path d={profile.roof} stroke={`url(#${gradientId})`} strokeWidth={strokeWidth * 1.6} strokeLinecap="round" strokeLinejoin="round" />
      )}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FE7D18" />
          <stop offset="100%" stopColor="#FD5B0D" />
        </linearGradient>
      </defs>
    </svg>
  )
}
