import {
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Label,
  MoneyDisplay,
  RadioGroup,
  RadioGroupItem,
} from '@carup/design-system'
import { ArrowUpDown, MessageCircle, MessageSquare, Phone, Scale, X } from 'lucide-react'

export const ContactSeller = () => (
  <Drawer defaultOpen>
    <DrawerTrigger asChild>
      <Button><MessageSquare /> Contact seller</Button>
    </DrawerTrigger>
    <DrawerContent>
      <div className="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Contact Tendai Motors</DrawerTitle>
          <DrawerDescription>Toyota Hilux 2.8 GD-6 Raider · Harare · usually replies within 2 hours</DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-2 px-4">
          <Button><MessageSquare /> Send an enquiry</Button>
          <Button variant="outline"><MessageCircle /> Message on WhatsApp</Button>
          <Button variant="outline"><Phone /> Call the dealer</Button>
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>
)

const compared = [
  { title: 'Toyota Hilux 2.8 GD-6 Raider', meta: '2021 · 62,400 km · Harare', amount: 38500 },
  { title: 'Nissan NP200 1.6', meta: '2020 · 88,100 km · Mutare', amount: 9800 },
  { title: 'Mazda CX-5 2.2D Akera', meta: '2019 · 71,000 km · Harare', amount: 24500 },
]

export const SideCompare = () => (
  <Drawer defaultOpen direction="right">
    <DrawerTrigger asChild>
      <Button variant="outline"><Scale /> Compare (3)</Button>
    </DrawerTrigger>
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle>Compare vehicles</DrawerTitle>
        <DrawerDescription>3 of 4 slots used</DrawerDescription>
      </DrawerHeader>
      <div className="grid gap-2 px-4">
        {compared.map((v) => (
          <div key={v.title} className="flex items-start gap-3 rounded-md border p-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-sm font-medium">{v.title}</div>
              <div className="text-xs text-muted-foreground">{v.meta}</div>
              <MoneyDisplay amount={v.amount} currency="USD" source="asking" />
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${v.title}`}><X /></Button>
          </div>
        ))}
      </div>
      <DrawerFooter>
        <Button>Compare side by side</Button>
        <DrawerClose asChild>
          <Button variant="outline">Keep browsing</Button>
        </DrawerClose>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
)

const sorts = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'mileage', label: 'Lowest mileage' },
]

export const SortOptions = () => (
  <Drawer defaultOpen>
    <DrawerTrigger asChild>
      <Button variant="outline"><ArrowUpDown /> Sort</Button>
    </DrawerTrigger>
    <DrawerContent>
      <div className="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Sort listings</DrawerTitle>
          <DrawerDescription>248 published vehicles</DrawerDescription>
        </DrawerHeader>
        <RadioGroup defaultValue="price-asc" className="gap-1 px-4">
          {sorts.map((s) => (
            <div key={s.value} className="flex items-center gap-3 rounded-md px-2 py-2.5">
              <RadioGroupItem value={s.value} id={`sort-${s.value}`} />
              <Label htmlFor={`sort-${s.value}`} className="font-normal">{s.label}</Label>
            </div>
          ))}
        </RadioGroup>
        <DrawerFooter>
          <Button>Apply</Button>
          <DrawerClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </div>
    </DrawerContent>
  </Drawer>
)
