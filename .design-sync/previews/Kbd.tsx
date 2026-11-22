import { Button, Kbd, KbdGroup } from '@carup/design-system'
import { ArrowDown, ArrowUp, CornerDownLeft, Search } from 'lucide-react'

export const Keys = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Kbd>Esc</Kbd>
    <Kbd>Tab</Kbd>
    <Kbd>⌘</Kbd>
    <Kbd>Shift</Kbd>
    <Kbd><ArrowUp /></Kbd>
    <Kbd><ArrowDown /></Kbd>
    <Kbd><CornerDownLeft /></Kbd>
  </div>
)

export const Combinations = () => (
  <div className="grid items-center gap-x-4 gap-y-3 text-sm" style={{ gridTemplateColumns: 'max-content 1fr' }}>
    <KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
    <span className="text-muted-foreground">Search the marketplace (macOS)</span>
    <KbdGroup><Kbd>Ctrl</Kbd><span className="text-muted-foreground">+</span><Kbd>K</Kbd></KbdGroup>
    <span className="text-muted-foreground">Search the marketplace (Windows)</span>
    <KbdGroup><Kbd>Shift</Kbd><Kbd>S</Kbd></KbdGroup>
    <span className="text-muted-foreground">Save this search</span>
  </div>
)

export const InSearchButton = () => (
  <Button variant="outline" className="justify-start text-muted-foreground" style={{ width: 320 }}>
    <Search />
    Search Hilux, Fit, CX-5…
    <KbdGroup className="ml-auto"><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
  </Button>
)

export const ShortcutList = () => (
  <div className="w-[340px] rounded-lg border bg-card p-4">
    <p className="mb-3 text-sm font-semibold">Listing review shortcuts</p>
    <dl className="grid items-center gap-y-2 text-sm" style={{ gridTemplateColumns: '1fr auto' }}>
      <dt className="text-muted-foreground">Next listing</dt>
      <dd className="text-right"><Kbd>J</Kbd></dd>
      <dt className="text-muted-foreground">Previous listing</dt>
      <dd className="text-right"><Kbd>K</Kbd></dd>
      <dt className="text-muted-foreground">Open photo gallery</dt>
      <dd className="text-right"><Kbd>G</Kbd></dd>
      <dt className="text-muted-foreground">Request more photos</dt>
      <dd className="text-right"><KbdGroup><Kbd>Shift</Kbd><Kbd>R</Kbd></KbdGroup></dd>
      <dt className="text-muted-foreground">Close panel</dt>
      <dd className="text-right"><Kbd>Esc</Kbd></dd>
    </dl>
  </div>
)
