import { Calendar } from '@carup/design-system'

// Fixed dates keep captures deterministic: "today" is pinned to 15 Nov 2026.
const today = new Date(2026, 10, 15)
const noop = () => {}

export const InspectionDate = () => (
  <Calendar
    mode="single"
    selected={new Date(2026, 10, 20)}
    onSelect={noop}
    defaultMonth={today}
    today={today}
    disabled={[{ before: today }, { dayOfWeek: [0] }]}
    className="rounded-md border"
  />
)

export const HireRange = () => (
  <Calendar
    mode="range"
    selected={{ from: new Date(2026, 11, 18), to: new Date(2026, 11, 23) }}
    onSelect={noop}
    defaultMonth={new Date(2026, 11, 1)}
    today={today}
    className="rounded-md border"
  />
)

export const DropdownCaption = () => (
  <Calendar
    mode="single"
    captionLayout="dropdown"
    selected={new Date(2019, 2, 14)}
    onSelect={noop}
    defaultMonth={new Date(2019, 2, 1)}
    startMonth={new Date(2000, 0)}
    endMonth={new Date(2026, 11)}
    today={today}
    className="rounded-md border"
  />
)
