import { useEffect, useRef } from 'react'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@carup/design-system'
import { Car, Copy, Download, ExternalLink, ImageIcon, RotateCw, Star, Trash2 } from 'lucide-react'

// Radix ContextMenu has no `open`/`defaultOpen` prop: the real menu only opens
// from a contextmenu event. Fire one (at a point inside the trigger) after
// mount so the card shows the actual open menu, not a lookalike.
function useOpenAt(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + x, clientY: r.top + y }),
    )
  }, [x, y])
  return ref
}

const photos = ['Front ¾', 'Interior', 'Engine bay', 'Rear', 'Load bin', 'Wheels']

export const PhotoManager = () => {
  const ref = useOpenAt(70, 60)
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-semibold">Photos · Toyota Hilux 2.8 GD-6 Raider</div>
        <p className="text-xs text-muted-foreground">Right-click a photo for options.</p>
      </div>
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>
          <div ref={ref} className="grid grid-cols-3 gap-2 rounded-md border border-dashed p-2">
            {photos.map((p, i) => (
              <div key={p} className="flex h-20 flex-col items-center justify-center gap-1 rounded-md bg-muted text-xs text-muted-foreground">
                <ImageIcon className="size-4" />
                {p}
                {i === 0 && <span className="text-[10px] font-medium text-foreground">Cover</span>}
              </div>
            ))}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem><Star /> Set as cover photo</ContextMenuItem>
          <ContextMenuItem><RotateCw /> Rotate 90° <ContextMenuShortcut>R</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem><Download /> Download original</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive"><Trash2 /> Remove photo</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

export const VehicleRow = () => {
  const ref = useOpenAt(160, 28)
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-semibold">Inventory · Tendai Motors</div>
        <p className="text-xs text-muted-foreground">Right-click a vehicle for quick actions.</p>
      </div>
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>
          <div ref={ref} className="flex items-center gap-3 rounded-md border bg-card p-3">
            <Car className="size-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Honda Fit 1.5 Hybrid</div>
              <div className="text-xs text-muted-foreground">2015 · 104,000 km · Bulawayo · Published</div>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuLabel>Honda Fit 1.5 Hybrid</ContextMenuLabel>
          <ContextMenuItem><ExternalLink /> Open listing <ContextMenuShortcut>↵</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem><Copy /> Copy listing link <ContextMenuShortcut>⌘C</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger inset>Move to</ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-44">
              <ContextMenuItem>Drafts</ContextMenuItem>
              <ContextMenuItem>Reserved</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem checked>Show on dealer profile</ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive"><Trash2 /> Withdraw listing</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
