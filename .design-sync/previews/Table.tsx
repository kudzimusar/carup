import {
  Badge,
  Button,
  Checkbox,
  MoneyDisplay,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TrustLens,
} from '@carup/design-system'
import { FileSearch, History, MoreHorizontal } from 'lucide-react'

const tone = {
  live: 'border-status-success bg-status-success-soft text-status-success',
  reserved: 'border-status-warning bg-status-warning-soft text-status-warning',
  draft: 'border-status-neutral bg-status-neutral-soft text-status-neutral',
  expired: 'border-status-danger bg-status-danger-soft text-status-danger',
}

const stock = [
  { id: 'HLX-021', title: 'Toyota Hilux 2.8 GD-6 Raider', year: 2021, km: '62,400 km', price: 38500, currency: 'USD', status: 'live', enquiries: 14 },
  { id: 'CX5-019', title: 'Mazda CX-5 2.0 Active', year: 2019, km: '71,300 km', price: 21900, currency: 'USD', status: 'reserved', enquiries: 9 },
  { id: 'FIT-017', title: 'Honda Fit Hybrid 1.5', year: 2017, km: '98,200 km', price: 196000, currency: 'ZiG', status: 'live', enquiries: 6 },
  { id: 'NP2-018', title: 'Nissan NP200 1.6', year: 2018, km: '120,050 km', price: null, currency: 'USD', status: 'draft', enquiries: 0 },
  { id: 'RAN-016', title: 'Ford Ranger 2.2 XL', year: 2016, km: '143,900 km', price: 17500, currency: 'USD', status: 'expired', enquiries: 2 },
] as const

export const DealerInventory = () => (
  <Table>
    <TableCaption>Borrowdale Motors · Harare showroom · 5 of 42 vehicles</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead className="w-8"><Checkbox aria-label="Select all" /></TableHead>
        <TableHead>Stock ID</TableHead>
        <TableHead>Vehicle</TableHead>
        <TableHead>Mileage</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">Enquiries</TableHead>
        <TableHead className="text-right">Asking price</TableHead>
        <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {stock.map((v) => (
        <TableRow key={v.id} data-state={v.id === 'CX5-019' ? 'selected' : undefined}>
          <TableCell><Checkbox aria-label={`Select ${v.title}`} defaultChecked={v.id === 'CX5-019'} /></TableCell>
          <TableCell className="font-mono text-xs">{v.id}</TableCell>
          <TableCell>
            <div className="font-medium">{v.title}</div>
            <div className="text-xs text-muted-foreground">{v.year}</div>
          </TableCell>
          <TableCell className="tabular-nums">{v.km}</TableCell>
          <TableCell>
            <Badge variant="outline" className={tone[v.status]}>{v.status[0].toUpperCase() + v.status.slice(1)}</Badge>
          </TableCell>
          <TableCell className="text-right tabular-nums">{v.enquiries}</TableCell>
          <TableCell className="text-right"><MoneyDisplay amount={v.price} currency={v.currency} /></TableCell>
          <TableCell><Button variant="ghost" size="icon-sm" aria-label="Row actions"><MoreHorizontal /></Button></TableCell>
        </TableRow>
      ))}
    </TableBody>
    <TableFooter>
      <TableRow>
        <TableCell colSpan={5}>Enquiries this month</TableCell>
        <TableCell className="text-right tabular-nums">31</TableCell>
        <TableCell colSpan={2} />
      </TableRow>
    </TableFooter>
  </Table>
)

const compare = [
  { title: 'Toyota Hilux 2.8 GD-6', price: 38500, year: '2021', km: '62,400 km', fuel: 'Diesel', gearbox: 'Automatic', location: 'Harare', lens: { state: 'evaluated', sources: 3, at: '12 Nov 2026' } },
  { title: 'Mazda CX-5 2.0 Active', price: 21900, year: '2019', km: '71,300 km', fuel: 'Petrol', gearbox: 'Automatic', location: 'Harare', lens: { state: 'partial', sources: 2, at: '10 Nov 2026' } },
  { title: 'Honda Fit Hybrid 1.5', price: 7800, year: '2017', km: '98,200 km', fuel: 'Hybrid', gearbox: 'CVT', location: 'Bulawayo', lens: { state: 'stale', sources: 1, at: '02 Jun 2026' } },
] as const

const specRows: [string, (c: (typeof compare)[number]) => string][] = [
  ['Year', (c) => c.year],
  ['Mileage', (c) => c.km],
  ['Fuel', (c) => c.fuel],
  ['Transmission', (c) => c.gearbox],
  ['Location', (c) => c.location],
]

export const VehicleComparison = () => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead className="w-36 text-muted-foreground">Compare</TableHead>
        {compare.map((c) => <TableHead key={c.title}>{c.title}</TableHead>)}
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell className="text-muted-foreground">Asking price</TableCell>
        {compare.map((c) => <TableCell key={c.title}><MoneyDisplay amount={c.price} currency="USD" /></TableCell>)}
      </TableRow>
      {specRows.map(([label, get]) => (
        <TableRow key={label}>
          <TableCell className="text-muted-foreground">{label}</TableCell>
          {compare.map((c) => <TableCell key={c.title}>{get(c)}</TableCell>)}
        </TableRow>
      ))}
      <TableRow>
        <TableCell className="text-muted-foreground">Trust position</TableCell>
        {compare.map((c) => (
          <TableCell key={c.title}>
            <TrustLens state={c.lens.state} sourceCount={c.lens.sources} freshness={c.lens.at} />
          </TableCell>
        ))}
      </TableRow>
    </TableBody>
  </Table>
)

const requests = [
  { vin: 'AHTKB8CD702938471', fact: 'Odometer reading', current: '58,900 km', requested: '62,400 km', role: 'Dealer', evidence: 2, status: 'pending', created: '13 Nov 2026' },
  { vin: 'JMZKF4W7600417382', fact: 'Accident history', current: 'None recorded', requested: 'Minor, 2022', role: 'Mechanic', evidence: 1, status: 'approved', created: '09 Nov 2026' },
  { vin: 'JHMGP5830HS201945', fact: 'Service records', current: '3 records', requested: '4 records', role: 'Private seller', evidence: 0, status: 'rejected', created: '04 Nov 2026' },
]

const reqTone: Record<string, string> = {
  pending: 'border-status-warning bg-status-warning-soft text-status-warning',
  approved: 'border-status-info bg-status-info-soft text-status-info',
  rejected: 'border-status-danger bg-status-danger-soft text-status-danger',
}

export const ReviewQueue = () => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>VIN</TableHead>
        <TableHead>Trust fact</TableHead>
        <TableHead>Requested change</TableHead>
        <TableHead className="text-right">Evidence</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {requests.map((r) => (
        <TableRow key={r.vin}>
          <TableCell className="font-mono text-xs">{r.vin}</TableCell>
          <TableCell>
            <div>{r.fact}</div>
            <div className="text-xs text-muted-foreground">by {r.role}</div>
          </TableCell>
          <TableCell>
            <span className="text-muted-foreground line-through">{r.current}</span> → {r.requested}
          </TableCell>
          <TableCell className="text-right tabular-nums">{r.evidence}</TableCell>
          <TableCell>
            <Badge variant="outline" className={reqTone[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge>
          </TableCell>
          <TableCell>
            <div className="flex justify-end gap-1">
              <Button size="icon-sm" variant="outline" aria-label="Open evidence"><FileSearch /></Button>
              <Button size="icon-sm" variant="outline" aria-label="Audit trail"><History /></Button>
              {r.status === 'pending' && <Button size="sm">Review</Button>}
            </div>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
)
