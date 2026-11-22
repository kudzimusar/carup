import { Button, Toaster, toast } from '@carup/design-system'
import { Heart } from 'lucide-react'
import { useEffect } from 'react'

// Toasts persist (duration: Infinity) so the static preview shows them; fixed ids keep
// a remount from stacking duplicates.
export const AfterSavingVehicle = () => {
  useEffect(() => {
    toast.success('Toyota Hilux 2.8 GD-6 saved!', {
      id: 'saved',
      description: "We'll let you know if the price changes.",
      duration: Infinity,
    })
    toast('Enquiry sent to Harare Auto Hub', {
      id: 'enquiry',
      description: 'Dealers usually reply within 2 hours.',
      duration: Infinity,
    })
    toast.error('Could not update saved cars. Please try again.', { id: 'error', duration: Infinity })
  }, [])

  return (
    <div className="relative" style={{ height: 372 }}>
      <div className="flex items-center justify-between rounded-lg border p-4" style={{ maxWidth: 360 }}>
        <div>
          <p className="text-sm font-medium">Toyota Hilux 2.8 GD-6 Raider</p>
          <p className="text-xs text-muted-foreground">2021 · 62,400 km · Harare</p>
        </div>
        <Button size="icon" variant="outline" aria-label="Saved"><Heart /></Button>
      </div>
      <Toaster position="bottom-right" expand />
    </div>
  )
}
