import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@carup/design-system'
import { FileText, Search, ShieldCheck, ShoppingCart } from 'lucide-react'

const buySections = [
  {
    title: 'Vehicles',
    items: [
      { label: 'Shop All Cars', description: 'Browse every eligible listing', icon: ShoppingCart },
      { label: 'Recently Imported', description: 'Import inventory landed in the last 90 days' },
      { label: 'Locally Used', description: 'Zimbabwe-registered, locally owned' },
      { label: 'Dealer Listings', description: 'Stock from registered dealerships' },
    ],
  },
  {
    title: 'Popular categories',
    items: [
      { label: 'Toyota', description: 'Hilux, Fortuner, Corolla and more' },
      { label: 'Honda', description: 'Fit, CR-V, Vezel' },
      { label: 'Under $5,000', description: 'Asking price in USD' },
      { label: 'Under $10,000', description: 'Asking price in USD' },
    ],
  },
  {
    title: 'Buyer tools',
    items: [
      { label: 'Verify Before You Buy', description: 'Search by plate, VIN or chassis', icon: ShieldCheck },
      { label: 'View Vehicle Passport', description: 'Ownership, service and evidence timeline', icon: FileText },
      { label: 'Saved searches', description: 'Alerts when new matches are listed', icon: Search },
    ],
  },
]

const MenuLink = ({ label, description, icon: Icon }: { label: string; description: string; icon?: typeof Search }) => (
  <li>
    <NavigationMenuLink href="#">
      <span className="flex items-center gap-2 font-medium text-foreground">
        {Icon ? <Icon className="size-4" /> : null}
        {label}
      </span>
      <span className="text-xs leading-snug text-muted-foreground">{description}</span>
    </NavigationMenuLink>
  </li>
)

const MarketplaceNav = ({ open }: { open: string }) => (
  <NavigationMenu defaultValue={open}>
    <NavigationMenuList>
      <NavigationMenuItem value="buy">
        <NavigationMenuTrigger>Buy</NavigationMenuTrigger>
        <NavigationMenuContent>
          <div className="grid grid-cols-3 gap-4 p-2" style={{ width: 720 }}>
            {buySections.map((section) => (
              <div key={section.title}>
                <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</p>
                <ul>
                  {section.items.map((item) => <MenuLink key={item.label} {...item} />)}
                </ul>
              </div>
            ))}
          </div>
        </NavigationMenuContent>
      </NavigationMenuItem>
      <NavigationMenuItem value="sell">
        <NavigationMenuTrigger>Sell</NavigationMenuTrigger>
        <NavigationMenuContent>
          <ul className="grid gap-1 p-2" style={{ width: 360 }}>
            <MenuLink label="Sell Your Car" description="List privately with a Vehicle Passport" />
            <MenuLink label="Start with Plate / VIN" description="We prefill make, model and year" />
            <MenuLink label="Upload Vehicle Evidence" description="Service books, receipts and photos" />
            <MenuLink label="Add Service History" description="Records a future buyer can rely on" />
          </ul>
        </NavigationMenuContent>
      </NavigationMenuItem>
      <NavigationMenuItem value="verify">
        <NavigationMenuTrigger>Verify</NavigationMenuTrigger>
        <NavigationMenuContent>
          <ul className="grid grid-cols-2 gap-1 p-2" style={{ width: 520 }}>
            <MenuLink label="Verify by Plate" description="Zimbabwe registration number" icon={Search} />
            <MenuLink label="Verify by VIN" description="17-character vehicle identifier" icon={Search} />
            <MenuLink label="ZIMRA / Duty Signals" description="Surfaced inside vehicle search results" />
            <MenuLink label="Odometer / Mileage Signals" description="Readings from governed sources" />
          </ul>
        </NavigationMenuContent>
      </NavigationMenuItem>
      <NavigationMenuItem value="parts">
        <NavigationMenuTrigger>Parts</NavigationMenuTrigger>
        <NavigationMenuContent>
          <ul className="grid gap-1 p-2" style={{ width: 320 }}>
            <MenuLink label="Browse Car Parts" description="Engines, gearboxes, panels and more" />
            <MenuLink label="Tyres & Wheels" description="New and part-worn" />
          </ul>
        </NavigationMenuContent>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuLink href="#" className={navigationMenuTriggerStyle()}>Garages</NavigationMenuLink>
      </NavigationMenuItem>
    </NavigationMenuList>
  </NavigationMenu>
)

export const BuyMegaMenu = () => <MarketplaceNav open="buy" />

export const VerifyMenu = () => <MarketplaceNav open="verify" />
