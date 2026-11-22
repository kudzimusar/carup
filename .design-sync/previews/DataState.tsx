import { DataState } from '@carup/design-system'

const noop = () => {}

export const Loading = () => <DataState state="loading" subject="Service history" className="w-[360px]" />

export const Empty = () => (
  <DataState state="empty" subject="Saved vehicles" action={{ label: 'Browse marketplace', onClick: noop }} className="w-[360px]" />
)

export const ErrorState = () => (
  <DataState state="error" subject="Valuation" action={{ label: 'Retry', onClick: noop }} className="w-[360px]" />
)

export const Forbidden = () => <DataState state="forbidden" subject="Dealer ledger" className="w-[360px]" />

export const NotMeasured = () => <DataState state="not-measured" subject="Emissions rating" className="w-[360px]" />

export const Unavailable = () => (
  <DataState state="unavailable" subject="Trade-in valuation" action={{ label: 'Get estimate', onClick: noop }} className="w-[360px]" />
)
