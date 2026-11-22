import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@carup/design-system'
import {
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Copy,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Rocket,
  Settings,
  Share2,
  Trash2,
  Warehouse,
} from 'lucide-react'

export const ListingActions = () => (
  <div className="flex items-center justify-between rounded-md border bg-card p-3">
    <div>
      <div className="text-sm font-semibold">Toyota Hilux 2.8 GD-6 Raider</div>
      <div className="text-xs text-muted-foreground">Published · 14 enquiries · Harare</div>
    </div>
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Listing actions"><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Manage listing</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem><Pencil /> Edit listing <DropdownMenuShortcut>⌘E</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem><Copy /> Copy link <DropdownMenuShortcut>⌘C</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem><Share2 /> Share listing</DropdownMenuItem>
          <DropdownMenuItem><Rocket /> Boost visibility</DropdownMenuItem>
          <DropdownMenuItem><CheckCircle2 /> Mark as sold</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive"><Trash2 /> Withdraw listing</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
)

export const SortAndView = () => (
  <div className="flex items-center justify-between rounded-md border bg-card p-3">
    <div className="text-sm text-muted-foreground">248 published vehicles</div>
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">Sort: Price, low to high <ChevronDown /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value="price-asc">
          <DropdownMenuRadioItem value="newest">Newest first</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="price-asc">Price: low to high</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="price-desc">Price: high to low</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="mileage">Lowest mileage</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked>Dealer listings</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked>Private sellers</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={false}>Sold vehicles</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
)

export const UserMenu = () => (
  <div className="flex items-center justify-between rounded-md border bg-card p-3">
    <div className="text-sm font-semibold">CarUp</div>
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account">
          <Avatar className="size-8"><AvatarFallback>RC</AvatarFallback></Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">Rudo Chikwanha</div>
          <div className="text-xs text-muted-foreground">rudo.chikwanha@example.co.zw</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem><Warehouse /> My garage</DropdownMenuItem>
          <DropdownMenuItem><Bookmark /> Saved vehicles <DropdownMenuShortcut>12</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem><MessageSquare /> Messages <DropdownMenuShortcut>3 new</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem><Settings /> Settings</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
)
