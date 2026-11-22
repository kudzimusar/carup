import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@carup/design-system'

const Workspace = ({ children }: { children: React.ReactNode }) => (
  <div className="space-y-3">
    <div>
      <div className="text-sm font-semibold">Tendai Motors · Inventory</div>
      <div className="text-xs text-muted-foreground">42 published · 6 drafts · 3 reserved</div>
    </div>
    {children}
  </div>
)

const ListingMenuItems = () => (
  <MenubarContent>
    <MenubarItem>New listing <MenubarShortcut>⌘N</MenubarShortcut></MenubarItem>
    <MenubarItem>Duplicate as draft <MenubarShortcut>⌘D</MenubarShortcut></MenubarItem>
    <MenubarItem>Save draft <MenubarShortcut>⌘S</MenubarShortcut></MenubarItem>
    <MenubarSeparator />
    <MenubarSub>
      <MenubarSubTrigger>Export inventory</MenubarSubTrigger>
      <MenubarSubContent>
        <MenubarItem>CSV spreadsheet</MenubarItem>
        <MenubarItem>PDF stock sheet</MenubarItem>
      </MenubarSubContent>
    </MenubarSub>
    <MenubarSeparator />
    <MenubarItem>Publish to marketplace</MenubarItem>
    <MenubarItem disabled>Boost visibility</MenubarItem>
    <MenubarItem variant="destructive">Withdraw listing</MenubarItem>
  </MenubarContent>
)

const MediaMenuItems = () => (
  <MenubarContent>
    <MenubarItem>Upload photos <MenubarShortcut>⌘U</MenubarShortcut></MenubarItem>
    <MenubarItem>Reorder gallery</MenubarItem>
    <MenubarSeparator />
    <MenubarItem>Review media tickets</MenubarItem>
  </MenubarContent>
)

const ViewMenuItems = () => (
  <MenubarContent>
    <MenubarCheckboxItem checked>Show drafts</MenubarCheckboxItem>
    <MenubarCheckboxItem checked={false}>Show sold vehicles</MenubarCheckboxItem>
    <MenubarSeparator />
    <MenubarRadioGroup value="comfortable">
      <MenubarRadioItem value="comfortable">Comfortable rows</MenubarRadioItem>
      <MenubarRadioItem value="compact">Compact rows</MenubarRadioItem>
    </MenubarRadioGroup>
    <MenubarSeparator />
    <MenubarItem inset>Reset columns</MenubarItem>
  </MenubarContent>
)

const HelpMenuItems = () => (
  <MenubarContent>
    <MenubarItem>Dealer guide</MenubarItem>
    <MenubarItem>Contact CarUp support</MenubarItem>
  </MenubarContent>
)

const InventoryMenubar = ({ open }: { open: string }) => (
  <Menubar defaultValue={open} className="w-fit">
    <MenubarMenu value="listing">
      <MenubarTrigger>Listing</MenubarTrigger>
      <ListingMenuItems />
    </MenubarMenu>
    <MenubarMenu value="media">
      <MenubarTrigger>Media</MenubarTrigger>
      <MediaMenuItems />
    </MenubarMenu>
    <MenubarMenu value="view">
      <MenubarTrigger>View</MenubarTrigger>
      <ViewMenuItems />
    </MenubarMenu>
    <MenubarMenu value="help">
      <MenubarTrigger>Help</MenubarTrigger>
      <HelpMenuItems />
    </MenubarMenu>
  </Menubar>
)

export const ListingMenu = () => (
  <Workspace>
    <InventoryMenubar open="listing" />
  </Workspace>
)

export const ViewMenu = () => (
  <Workspace>
    <InventoryMenubar open="view" />
  </Workspace>
)
