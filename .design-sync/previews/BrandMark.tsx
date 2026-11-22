import { BrandMark } from '@carup/design-system'

const Caption = ({ children }: { children: string }) => (
  <span className="font-mono text-[11px] text-carup-text-3">{children}</span>
)

export const InkChrome = () => (
  <div className="flex w-[500px] flex-col gap-3 rounded-card bg-carup-raw-ink p-5">
    <div className="flex items-center justify-between gap-4">
      <BrandMark slot="public-masthead" tone="ink" />
      <span className="font-mono text-[11px] text-carup-raw-paper">public-masthead</span>
    </div>
    <div className="flex items-center justify-between gap-4">
      <BrandMark slot="workspace-masthead" tone="ink" compact />
      <span className="font-mono text-[11px] text-carup-raw-paper">workspace-masthead · compact</span>
    </div>
    <div className="flex items-center justify-between gap-4">
      <BrandMark slot="workspace-rail" tone="ink" compact />
      <span className="font-mono text-[11px] text-carup-raw-paper">workspace-rail · compact</span>
    </div>
    <div className="flex items-center justify-between gap-4">
      <BrandMark slot="mobile-drawer" tone="ink" compact />
      <span className="font-mono text-[11px] text-carup-raw-paper">mobile-drawer · compact</span>
    </div>
  </div>
)

export const LightSurface = () => (
  <div className="flex w-[500px] flex-col gap-3 rounded-card border border-carup-line bg-carup-bg-raised p-5">
    <div className="flex items-center justify-between gap-4">
      <BrandMark slot="public-footer" tone="light" />
      <Caption>public-footer</Caption>
    </div>
    <div className="flex items-center justify-between gap-4">
      <BrandMark slot="focused-header" tone="light" compact />
      <Caption>focused-header · compact</Caption>
    </div>
  </div>
)

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-4">
    <div className="flex items-center gap-3 rounded-card bg-carup-raw-ink p-4">
      <BrandMark slot="public-masthead" tone="ink" />
      <BrandMark slot="workspace-masthead" tone="ink" compact />
    </div>
    <div className="flex items-center gap-3 rounded-card border border-carup-line bg-carup-bg-raised p-4">
      <BrandMark slot="public-footer" tone="light" />
      <BrandMark slot="focused-header" tone="light" compact />
    </div>
  </div>
)
