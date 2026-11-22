import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, EvidenceLine, Input, Label } from '@carup/design-system'
import { ChevronDown, ChevronsUpDown, ClipboardList, Plus } from 'lucide-react'

const InspectionNotes = ({ open }: { open: boolean }) => (
  <Collapsible defaultOpen={open} className="rounded-lg border bg-card" style={{ width: 460 }}>
    <CollapsibleTrigger asChild>
      <button
        type="button"
        className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold"
      >
        <span className="flex items-center gap-2">
          <ClipboardList className="size-4 text-carup-action" aria-hidden="true" />
          Inspection notes · 3 items
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent className="space-y-3 border-t px-4 pb-4 pt-3 text-sm">
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>Front brake pads at 30% - replace within 5,000 km</li>
        <li>Minor stone chip on windscreen, passenger side</li>
        <li>Rear left tyre tread 3 mm; other three 6 mm</li>
      </ul>
      <EvidenceLine actor="Mukuvisi Auto Clinic, Harare" source="Pre-purchase inspection report" at="11 Nov 2026" />
    </CollapsibleContent>
  </Collapsible>
)

export const Open = () => <InspectionNotes open />

export const Closed = () => <InspectionNotes open={false} />

export const ShowMoreSpecs = () => (
  <Collapsible defaultOpen className="space-y-2" style={{ width: 420 }}>
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-semibold">Specifications</h4>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm">
          <ChevronsUpDown /> Show less
        </Button>
      </CollapsibleTrigger>
    </div>
    <div className="rounded-md border px-4 py-2 text-sm">Toyota Hilux 2.8 GD-6 Raider · 2021 · Diesel</div>
    <CollapsibleContent className="space-y-2">
      <div className="rounded-md border px-4 py-2 text-sm">62,400 km · 6-speed automatic · 4x4</div>
      <div className="rounded-md border px-4 py-2 text-sm">Double cab · 5 seats · Tow bar fitted</div>
    </CollapsibleContent>
  </Collapsible>
)

export const DashedAddForm = () => (
  <Collapsible defaultOpen className="rounded-2xl border border-dashed border-slate-300" style={{ width: 460 }}>
    <CollapsibleTrigger asChild>
      <button
        type="button"
        className="group flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold hover:bg-slate-50"
      >
        <span className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-orange-700" aria-hidden="true" />
          Add or edit a branch
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent className="space-y-3 border-t border-dashed border-slate-300 px-4 pb-5 pt-4">
      <div className="space-y-1.5">
        <Label htmlFor="branch-name">Branch name</Label>
        <Input id="branch-name" defaultValue="Bulawayo - Fife Street" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="branch-address">Physical address</Label>
        <Input id="branch-address" defaultValue="88 Fife Street, Bulawayo" />
      </div>
    </CollapsibleContent>
  </Collapsible>
)
