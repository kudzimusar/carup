import { useEffect } from 'react'
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useForm,
} from '@carup/design-system'

type Enquiry = { name: string; phone: string; message: string }

export const EnquiryForm = () => {
  const form = useForm<Enquiry>({
    defaultValues: {
      name: 'Tendai Moyo',
      phone: '+263 77 123 4567',
      message: 'Is the Mazda CX-5 still available? I can view it in Harare on Saturday.',
    },
  })
  return (
    <Form {...form}>
      <form className="grid w-[400px] gap-5" onSubmit={form.handleSubmit(() => {})}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Your name</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>WhatsApp number</FormLabel>
              <FormControl><Input type="tel" {...field} /></FormControl>
              <FormDescription>The dealer replies on WhatsApp. Your number is never shown publicly.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Message</FormLabel>
              <FormControl><Textarea rows={3} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full">Send enquiry</Button>
      </form>
    </Form>
  )
}

type Listing = { mileage: string; plate: string }

export const ValidationErrors = () => {
  const form = useForm<Listing>({ defaultValues: { mileage: '', plate: 'AB 12' } })
  useEffect(() => {
    form.setError('mileage', { type: 'required', message: 'Enter the odometer reading in km.' })
    form.setError('plate', { type: 'pattern', message: 'Use the Zimbabwe format, e.g. ABC 1234.' })
  }, [form])
  return (
    <Form {...form}>
      <form className="grid w-[400px] gap-5" onSubmit={form.handleSubmit(() => {})}>
        <FormField
          control={form.control}
          name="mileage"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mileage (km)</FormLabel>
              <FormControl><Input inputMode="numeric" placeholder="e.g. 45000" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="plate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Number plate</FormLabel>
              <FormControl><Input className="font-mono" {...field} /></FormControl>
              <FormDescription>Required once the vehicle is locally registered.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Continue to photos</Button>
      </form>
    </Form>
  )
}

type Details = { condition: string; negotiable: boolean }

export const WithSelectAndCheckbox = () => {
  const form = useForm<Details>({ defaultValues: { condition: 'good', negotiable: true } })
  return (
    <Form {...form}>
      <form className="grid w-[400px] gap-5" onSubmit={form.handleSubmit(() => {})}>
        <FormField
          control={form.control}
          name="condition"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Condition</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="excellent">Excellent</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair, needs some work</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>Be honest: the inspection report will show the real condition.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="negotiable"
          render={({ field }) => (
            <FormItem className="flex items-start gap-3 rounded-md border p-4">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="grid gap-1.5">
                <FormLabel>Price is negotiable</FormLabel>
                <FormDescription>Buyers see a "Negotiable" tag and can make an offer.</FormDescription>
              </div>
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}
