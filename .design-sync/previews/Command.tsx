import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@carup/design-system'
import {
  Bookmark,
  CalendarCheck,
  Car,
  CreditCard,
  FileSpreadsheet,
  History,
  Images,
  MessageSquare,
  Plus,
  SearchX,
  Users,
} from 'lucide-react'

const frame = { maxWidth: 560 }

export const BuyerSearch = () => (
  <Command className="rounded-lg border shadow-md" style={frame} label="Search CarUp">
    <CommandInput placeholder="Search makes, models or listings…" />
    <CommandList style={{ maxHeight: 440 }}>
      <CommandEmpty>No vehicles found.</CommandEmpty>
      <CommandGroup heading="Recent searches">
        <CommandItem><History /> Toyota Hilux under $40,000</CommandItem>
        <CommandItem><History /> Honda Fit · Bulawayo</CommandItem>
      </CommandGroup>
      <CommandGroup heading="Vehicles">
        <CommandItem value="toyota hilux 2.8 gd-6 raider">
          <Car /> Toyota Hilux 2.8 GD-6 Raider
          <span className="ml-auto text-xs text-muted-foreground">2021 · Harare</span>
        </CommandItem>
        <CommandItem value="mazda cx-5 2.2d akera">
          <Car /> Mazda CX-5 2.2D Akera
          <span className="ml-auto text-xs text-muted-foreground">2019 · Harare</span>
        </CommandItem>
        <CommandItem value="nissan np200 1.6">
          <Car /> Nissan NP200 1.6
          <span className="ml-auto text-xs text-muted-foreground">2020 · Mutare</span>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Go to">
        <CommandItem><Bookmark /> Saved vehicles <CommandShortcut>⌘S</CommandShortcut></CommandItem>
        <CommandItem><MessageSquare /> Messages <CommandShortcut>⌘M</CommandShortcut></CommandItem>
        <CommandItem><CalendarCheck /> Book an inspection <CommandShortcut>⌘I</CommandShortcut></CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
)

export const EmptyResults = () => (
  <Command className="rounded-lg border shadow-md" style={frame} label="Search CarUp">
    <CommandInput value="Lamborghini Urus" placeholder="Search makes, models or listings…" />
    <CommandList>
      <CommandEmpty>
        <div className="flex flex-col items-center gap-2 px-6">
          <SearchX className="size-5 text-muted-foreground" />
          <div className="font-medium">No vehicles match “Lamborghini Urus”</div>
          <div className="text-xs text-muted-foreground">Try a make or model such as Toyota or Honda, or save this search to get an alert.</div>
          <Button size="sm" variant="outline" className="mt-1">Save search</Button>
        </div>
      </CommandEmpty>
      <CommandGroup heading="Vehicles">
        <CommandItem><Car /> Toyota Hilux 2.8 GD-6 Raider</CommandItem>
        <CommandItem><Car /> Honda Fit 1.5 Hybrid</CommandItem>
        <CommandItem><Car /> Mazda CX-5 2.2D Akera</CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
)

export const WorkspaceActions = () => (
  <Command className="rounded-lg border shadow-md" style={frame} label="Dealer workspace actions">
    <CommandInput placeholder="Type a command or search…" />
    <CommandList style={{ maxHeight: 440 }}>
      <CommandEmpty>No matching action.</CommandEmpty>
      <CommandGroup heading="Inventory">
        <CommandItem><Plus /> Add a vehicle <CommandShortcut>⌘N</CommandShortcut></CommandItem>
        <CommandItem><FileSpreadsheet /> Import from spreadsheet</CommandItem>
        <CommandItem><Images /> Review media tickets</CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Enquiries">
        <CommandItem><MessageSquare /> Open enquiries <CommandShortcut>7</CommandShortcut></CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Account">
        <CommandItem><Users /> Team members</CommandItem>
        <CommandItem disabled><CreditCard /> Billing (owner only)</CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
)
