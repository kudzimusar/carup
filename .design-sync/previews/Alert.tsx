import { Alert, AlertDescription, AlertTitle, Button } from '@carup/design-system'
import { CalendarCheck, CircleAlert, FileWarning, Info } from 'lucide-react'

export const Default = () => (
  <Alert style={{ width: 420 }}>
    <CalendarCheck />
    <AlertTitle>Inspection booked</AlertTitle>
    <AlertDescription>
      Harare Auto Hub will inspect the Toyota Hilux on Saturday 21 Nov at 09:00. The seller has been notified.
    </AlertDescription>
  </Alert>
)

export const Destructive = () => (
  <Alert variant="destructive" style={{ width: 420 }}>
    <CircleAlert />
    <AlertTitle>Listing could not be published</AlertTitle>
    <AlertDescription>
      <p>Upload the vehicle registration book before your listing goes live.</p>
      <ul className="list-inside list-disc text-sm">
        <li>Registration book (front page)</li>
        <li>Proof of ZIMRA duty clearance</li>
      </ul>
    </AlertDescription>
  </Alert>
)

export const WithAction = () => (
  <Alert style={{ width: 420 }}>
    <FileWarning />
    <AlertTitle>Ownership documents missing</AlertTitle>
    <AlertDescription>
      <p>Your Honda Fit is saved as a draft. Buyers can't see it until ownership is confirmed.</p>
      <Button size="sm" className="mt-1">Upload documents</Button>
    </AlertDescription>
  </Alert>
)

export const TitleOnly = () => (
  <Alert style={{ width: 420 }}>
    <Info />
    <AlertTitle>Prices on this page are shown in USD.</AlertTitle>
  </Alert>
)
