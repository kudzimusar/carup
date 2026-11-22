import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  buttonVariants,
} from '@carup/design-system'
import { CheckCircle2, Trash2, Upload } from 'lucide-react'

const noAutoFocus = (e: Event) => e.preventDefault()

export const ConfirmWithdrawal = () => (
  <AlertDialog defaultOpen>
    <AlertDialogTrigger asChild>
      <Button variant="outline"><Trash2 /> Withdraw listing</Button>
    </AlertDialogTrigger>
    <AlertDialogContent onOpenAutoFocus={noAutoFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>Withdraw this listing?</AlertDialogTitle>
        <AlertDialogDescription>
          Toyota Hilux 2.8 GD-6 Raider will be removed from the marketplace and buyers with open enquiries will be
          told it is no longer available. You can relist it from your dashboard within 30 days.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep listing</AlertDialogCancel>
        <AlertDialogAction className={buttonVariants({ variant: 'destructive' })}>Withdraw listing</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)

export const MarkAsSold = () => (
  <AlertDialog defaultOpen>
    <AlertDialogTrigger asChild>
      <Button variant="secondary"><CheckCircle2 /> Mark as sold</Button>
    </AlertDialogTrigger>
    <AlertDialogContent onOpenAutoFocus={noAutoFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>Mark the Honda Fit as sold?</AlertDialogTitle>
        <AlertDialogDescription>
          This closes 3 open enquiries and moves the listing to Sold in your inventory. The agreed price stays private
          to you and the buyer.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Not yet</AlertDialogCancel>
        <AlertDialogAction>Mark as sold</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)

export const PendingRequirement = () => (
  <AlertDialog defaultOpen>
    <AlertDialogTrigger asChild>
      <Button><Upload /> Publish listing</Button>
    </AlertDialogTrigger>
    <AlertDialogContent onOpenAutoFocus={noAutoFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>Publish Nissan NP200 1.6 to the marketplace?</AlertDialogTitle>
        <AlertDialogDescription>
          Add at least 4 photos before publishing — this draft has 2. Everything you've entered so far is saved.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Back to draft</AlertDialogCancel>
        <AlertDialogAction disabled>Publish listing</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)
