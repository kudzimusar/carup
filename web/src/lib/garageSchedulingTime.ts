type WallClock = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
const OFFSET_SAMPLE_HOURS = [-48, -36, -24, -12, 0, 12, 24, 36, 48]

function formatter(timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
  } catch {
    throw new Error('Selected site timezone is invalid')
  }
}

function wallClockAt(instantMs: number, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(new Date(instantMs))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

function parseWallClock(value: string): WallClock {
  const match = LOCAL_DATETIME.exec(value)
  if (!match) throw new Error('Enter a valid appointment date and time')

  const parsed: WallClock = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || '0'),
  }
  const validation = new Date(Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
  ))
  if (
    validation.getUTCFullYear() !== parsed.year
    || validation.getUTCMonth() + 1 !== parsed.month
    || validation.getUTCDate() !== parsed.day
    || validation.getUTCHours() !== parsed.hour
    || validation.getUTCMinutes() !== parsed.minute
    || validation.getUTCSeconds() !== parsed.second
  ) {
    throw new Error('Enter a valid appointment date and time')
  }
  return parsed
}

function sameWallClock(left: WallClock, right: WallClock) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second
}

function offsetAt(instantMs: number, timeZone: string) {
  const wall = wallClockAt(instantMs, timeZone)
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  )
  const instantAtSecondPrecision = Math.floor(instantMs / 1000) * 1000
  return wallAsUtc - instantAtSecondPrecision
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function instantToGarageDateTimeLocal(instant: string, timeZone: string) {
  const value = Date.parse(instant)
  if (!Number.isFinite(value)) throw new Error('Appointment timestamp is invalid')
  const wall = wallClockAt(value, timeZone)
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`
}

export function garageDateTimeLocalToInstant(localValue: string, timeZone: string) {
  const target = parseWallClock(localValue)
  // Validate the IANA timezone before calculating offsets.
  formatter(timeZone)

  const naiveUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  )

  const offsets = new Set<number>()
  for (const hours of OFFSET_SAMPLE_HOURS) {
    offsets.add(offsetAt(naiveUtc + hours * 60 * 60 * 1000, timeZone))
  }

  const candidates = [...offsets]
    .map((offset) => naiveUtc - offset)
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .filter((candidate) => sameWallClock(wallClockAt(candidate, timeZone), target))
    .sort((a, b) => a - b)

  if (candidates.length === 0) {
    throw new Error(`This local time does not exist in ${timeZone}. Choose another appointment time.`)
  }
  if (candidates.length > 1) {
    throw new Error(`This local time is ambiguous in ${timeZone}. Choose an unambiguous appointment time.`)
  }

  return new Date(candidates[0]).toISOString()
}
