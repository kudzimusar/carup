# CarUp design-sync notes

## How this DS is built (read first)
- CarUp's design system lives INSIDE the web app (`web/src/components/{ui,truth,shell}`); there is no published
  library dist. `.design-sync/ds-entry.ts` is the curated DS surface (53 shadcn-style UI modules, the 5 RX-02 Truth
  components, BrandMark + the three unified shells, plus `toast`/`useForm`/`MemoryRouter` runtime exports).
  Adding a component to the DS = adding its export there.
- `cfg.buildCmd` = `node .design-sync/build-ds.mjs` (run from repo root). It compiles the entry into a generated
  package at `.design-sync/.cache/pkg` (ESM with every npm dep external, `tsc` .d.ts tree with `@/`/`@shared/`
  aliases rewritten to relative paths, and `dist/styles.css` from the app's own Tailwind config + `web/src/index.css`).
  The converter then runs with `cfg.entry` pointing at that package. ALWAYS re-run build-ds before package-build:
  the Tailwind content globs include `.design-sync/previews/**`, so preview-only classes need a CSS rebuild.
- Run from a SPACE-FREE checkout (the main checkout lives under "Project AI"; CarUp CLI guards silently no-op there).
- Install: `npm ci` at the repo root (npm workspaces; React 19 hoists to the root `node_modules`). Converter deps live
  in `.ds-sync/` (esbuild, ts-morph, @types/react, playwright@1.60.0 — 1.60 pins chromium 1223, already cached).
- Components = 62 FAMILY roots. shadcn exports flat siblings (CardHeader, DialogContent...) which the converter
  would list as 286 separate components; the 224 sub-parts are excluded via `componentSrcMap: null` but stay
  exported from the bundle (`window.CarUp.CardHeader`). Previews show them composed inside their family.
- Groups come from frontmatter-only stubs in `.design-sync/docs/<Name>.md` (`category:`); an empty body keeps the
  `.prompt.md` synthesized from the .d.ts + authored previews. Truth/shell groups come from their src dirs.
- Fonts: Inter 400/500/600/700 + JetBrains Mono 400/500 are base64 data-URIs inside the compiled CSS (from
  `npm run fonts:ensure`, pinned @fontsource) — there is no separate `fonts/` dir, and none is needed.
- Provider: every preview is wrapped in `MemoryRouter` (the shells render `<Link>`s). No theme provider exists:
  tokens are CSS custom properties on `:root`.

## Authoring rules learned in calibration
- Import DS parts from `'@carup/design-system'`; icons from `'lucide-react'` (bundled into the preview).
- `TrustLens` `freshness` takes the BARE date ("12 Nov 2026"): the component prefixes "updated" itself. Its JSDoc
  example ("Updated 12 Nov 2026") produces "updated Updated …" — source doc bug, reported, not changed here.
- Prices always through `MoneyDisplay` (explicit currency, `source` = asking/agreed/estimate/guide); trust only
  through `TrustLens`; never write "Verified"/"Police checked"/scores as plain text — CarUp's truth contract.
- Realistic CarUp content: Zimbabwe automotive marketplace (Harare, Bulawayo, Mutare), USD and ZiG, vehicles like
  Toyota Hilux 2.8 GD-6, Honda Fit, Nissan NP200, Mazda CX-5; dealers, inspections, enquiries, saved searches.
- Layout glue in previews: only use utility classes that exist in `ds-bundle/_ds_bundle.css` (grep it), or inline
  `style={{}}`. A class the CSS lacks renders unstyled until the orchestrator's next build-ds run.
- Don't name an export `Error` (shadows the global) — use `ErrorState`.

## Tailwind v4 syntax compatibility (DS CSS build only)
- The shadcn primitives in `web/src/components/ui` are written in Tailwind **v4** syntax but the app compiles with
  tailwindcss **3.4**, which silently emits nothing for v4-only spellings. `.design-sync/tailwind.ds.config.cjs`
  teaches 3.4 the spellings the DS uses: `(--var)` shorthand via theme keys named `(--cell-size)` etc.,
  `aria-invalid:` (theme.extend.aria), `has-disabled:`, `has-focus:`, `has-data-[…]:`, `in-data-[…]:`,
  `outline-hidden`, `field-sizing-content`, `:root{--spacing:.25rem}`, and a scoped Calendar `--cell-size:2rem`.
- NOT covered (minor): container queries (`@container/…`, `@md/field-group:` — Field's responsive orientation and
  Card header action layout), the v4 `!` important suffix (collapsed-icon Sidebar padding/size),
  `**:`/`*:[span]` variants (Command input height, Select value spacing), `--spacing(4)` inside calc (collapsed-icon
  Sidebar width), `gap-[--spacing(var(--gap))]` (ToggleGroup `spacing` prop is inert — stories use spacing=0).
- Re-scan on re-sync: `grep -rhoE "[a-z-]+-\(--[a-z0-9-]+\)" web/src/components/ui/*.tsx` — a new `(--var)` needs a key.

## Authoring techniques (learned across the five preview batches)
- Exports compile in ALPHABETICAL order: the first cell / single-mode default is the alphabetically-first export.
  Every single/column card pins its default with `cfg.overrides.<Name>.primaryStory`.
- Static open overlays: `defaultOpen` (Dialog, AlertDialog, Sheet, Drawer, Popover, DropdownMenu, Select),
  `open` (HoverCard, Tooltip — the DS Tooltip includes its provider), Menubar `defaultValue` + matching
  `MenubarMenu value`, NavigationMenu `defaultValue`. ContextMenu has no open prop: put a ref on the
  `ContextMenuTrigger asChild` element and dispatch a real `contextmenu` MouseEvent inside it in `useEffect`.
  `modal={false}` on DropdownMenu/ContextMenu stories. `onOpenAutoFocus={(e) => e.preventDefault()}` on
  Dialog/AlertDialog/Sheet/Popover content (else a focus ring + selected text is captured).
- Radix scroll-lock (open Select/menus/dialogs) zeroes the page body padding: give the story its own margin.
- DialogContent is a grid: rows with truncating text need `min-w-0`.
- Command: `CommandList` caps at 300px (`style={{maxHeight: 440}}` for a full palette); a fixed `CommandInput`
  value filters items (that is how the empty state is shown).
- ScrollArea needs `type="always"` to show bars statically. react-resizable-panels v4 reads numbers as px — use
  `"35%"` strings. Toaster: fixed toast ids + `duration: Infinity`, fired in `useEffect` via the DS `toast`.
- Recharts: `isAnimationActive={false}` on every mark (else captured mid-animation); YAxis width instead of the
  shadcn `margin={{left:-16}}` idiom; `ChartTooltip defaultIndex={n} active` for a static tooltip. Previews may
  import `recharts` directly (2.x matches Tooltip/Legend by displayName across copies) — on a recharts 3 upgrade,
  export its primitives from ds-entry.ts instead.
- Carousel arrows sit at ±48px: give the wrapper ~56px side padding. Avatar: inline `data:image/svg+xml` loads
  offline; a dead path shows the fallback initials.
- Truth components: TrustLens chip natural widths 281–365px (it wraps/clips in narrower slots, e.g. table cells);
  the emitted .d.ts drops `| null` from truth props, so "missing" states are shown by omitting the prop.
- Many arbitrary `w-[…]`/`size-*` classes are absent from the compiled CSS: inline `style` is the reliable glue.

## Known render warns
- `[TOKENS_MISSING] --slot, --spacing, --tw, --radix-*`: runtime variables set by Radix/Tailwind, not tokens.
- Full-height shells (WorkspaceShell, PublicShell) lose ~24px at the bottom of `?story=` capture sheets (capture
  padding); the product card has no padding. Graded on the product render.

## Product findings for the app team (reported, NOT changed — app source is out of scope)
- Tailwind v4 classes are dropped by the app's 3.4 build (see above): in production, invalid inputs keep a grey
  border, the Calendar collapses, Radix menus show the browser focus outline, the Sidebar width collapses, Alert
  icon columns misalign. SellVehicle works around it with manual `border-red-400`.
- `resizable.tsx` styles the vertical handle via `data-[panel-group-direction=vertical]`, but
  react-resizable-panels 4.11 only emits `aria-orientation` — vertical handles are invisible.
- WorkspaceShell always reserves a 320px status column; its object header is one row and truncates long titles;
  the owner nav shows two "Overview" items and prefix matching marks several rail items active (FR-7b).
- TrustLens `freshness` JSDoc example ("Updated 12 Nov 2026") double-prints "updated".
- No `--chart-N` series tokens exist (charts use action orange + info blue; neutral fails as a series colour).
- The DS Checkbox has no indeterminate visual.

## Re-sync risks
- `ds-entry.ts` enumerates the 53 UI modules: a new `web/src/components/ui/*.tsx` is NOT synced until added there.
- `componentSrcMap` nulls enumerate sub-parts: a new sub-part export appears as its own card until nulled.
- The CSS vocabulary = all of web/src + previews + safelisted token colours; renaming tokens in
  `shared/tokens/tokens.json` changes it (re-validate the conventions header).
- `build-ds.mjs` assumes `node_modules/esbuild`, `.bin/tsc`, `.bin/tailwindcss` from the repo install.
