import { Badge, ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@carup/design-system'

export const EnquiryWorkspace = () => (
  <ResizablePanelGroup orientation="horizontal" className="rounded-lg border" style={{ height: 260 }}>
    <ResizablePanel defaultSize="35%" minSize="25%">
      <div className="flex h-full flex-col gap-1 p-3 text-sm">
        <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enquiries</p>
        <div className="rounded-md bg-accent px-2 py-1.5">
          <p className="font-medium">Farai Chikwanha</p>
          <p className="truncate text-xs text-muted-foreground">Is the price negotiable for cash?</p>
        </div>
        <div className="rounded-md px-2 py-1.5">
          <p className="font-medium">Rudo Ncube</p>
          <p className="truncate text-xs text-muted-foreground">Can I view it on Saturday?</p>
        </div>
        <div className="rounded-md px-2 py-1.5">
          <p className="font-medium">Tatenda Banda</p>
          <p className="truncate text-xs text-muted-foreground">Has the battery been replaced?</p>
        </div>
      </div>
    </ResizablePanel>
    <ResizableHandle withHandle />
    <ResizablePanel defaultSize="65%">
      <div className="flex h-full flex-col gap-2 p-4 text-sm">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Farai Chikwanha</p>
          <Badge variant="secondary">Toyota Hilux 2.8 GD-6</Badge>
        </div>
        <p className="text-muted-foreground">10:42 · via CarUp messages</p>
        <p>Hi, is the price negotiable for cash? I can come to Borrowdale this weekend with my mechanic.</p>
      </div>
    </ResizablePanel>
  </ResizablePanelGroup>
)

export const VerticalSplit = () => (
  <ResizablePanelGroup orientation="vertical" className="rounded-lg border" style={{ height: 300, maxWidth: 520 }}>
    <ResizablePanel defaultSize="60%">
      <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">
        Inspection photos · 12
      </div>
    </ResizablePanel>
    {/* react-resizable-panels v4 marks the handle with aria-orientation, not the
        data-panel-group-direction attribute ResizableHandle's vertical styles key on,
        so a vertical group sizes its handle explicitly. */}
    <ResizableHandle className="h-px w-full" />
    <ResizablePanel defaultSize="40%">
      <div className="space-y-1 p-4 text-sm">
        <p className="font-medium">Inspector notes</p>
        <p className="text-muted-foreground">Minor stone chips on bonnet. Tyres at 60%. No leaks found at the rear diff.</p>
      </div>
    </ResizablePanel>
  </ResizablePanelGroup>
)

export const ThreePanels = () => (
  <ResizablePanelGroup orientation="horizontal" className="rounded-lg border text-sm" style={{ height: 160 }}>
    <ResizablePanel defaultSize="22%">
      <div className="flex h-full items-center justify-center p-3 font-medium">Filters</div>
    </ResizablePanel>
    <ResizableHandle />
    <ResizablePanel defaultSize="53%">
      <div className="flex h-full items-center justify-center p-3 font-medium">468 results</div>
    </ResizablePanel>
    <ResizableHandle />
    <ResizablePanel defaultSize="25%">
      <div className="flex h-full items-center justify-center p-3 font-medium">Compare (2)</div>
    </ResizablePanel>
  </ResizablePanelGroup>
)
