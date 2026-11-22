# CarUp design system — how to build with it

CarUp is Zimbabwe's evidence-led automotive marketplace: precision commerce, photo-led, honest about what is
and is not known. Every component is `window.CarUp.<Name>`, compiled from CarUp's real web app.

## Setup
- Load `styles.css` (tokens, fonts, component CSS) and `_ds_bundle.js`. No theme provider exists: tokens are CSS
  custom properties on `:root`, light theme only.
- Anything that renders links — `PublicShell`, `WorkspaceShell`, `Breadcrumb` used with router links — must sit
  inside `<MemoryRouter>` (exported from the bundle), or it throws.
- Toasts: render `<Toaster />` once and call `toast(...)` from the bundle (never a separate sonner copy).
  Forms: `useForm` from the bundle drives `Form` / `FormField` / `FormItem` / `FormLabel` / `FormControl` / `FormMessage`.
- `Sidebar` needs `SidebarProvider` around it; compound parts compose inside their family
  (`Card` > `CardHeader`/`CardTitle`/`CardDescription`/`CardAction`/`CardContent`/`CardFooter`;
  `Dialog` > `DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter`; `Select` > `SelectTrigger`/`SelectValue`/
  `SelectContent`/`SelectItem`; `Tabs` > `TabsList`/`TabsTrigger`/`TabsContent`;
  `Table` > `TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`).

## Truth rules (non-negotiable)
- Prices only through `MoneyDisplay` (explicit `currency`: USD, ZiG, ZAR, BWP; `source`: asking/agreed/estimate/guide).
- Trust only through `TrustLens` (state + `sourceCount` + `freshness` as a bare date). Never write "Verified",
  "Police checked", "accident free" or a score as plain text.
- Vehicle identity through `VehicleIdentity` (public by default: VIN shown as restricted); provenance through
  `EvidenceLine`; every loading/empty/error/forbidden/unavailable read through `DataState` — a failed read is never
  shown as empty, and missing values say "Not recorded", never 0.
- Listing photos are seller-supplied advertising, not evidence. Never use stock cars as listings.

## Styling idiom: Tailwind utilities on CarUp tokens
| Use | Classes |
|---|---|
| Surfaces | `bg-carup-bg` (page), `bg-carup-bg-surface`, `bg-carup-bg-raised` (white panels), dark bands `bg-carup-raw-ink` / `bg-carup-raw-navy` with `text-carup-raw-paper` |
| Text | `text-carup-text`, `text-carup-text-2` (secondary), `text-carup-text-3` (meta) |
| Lines | `border-carup-line`, `border-carup-line-strong` — hairlines before shadows |
| Action (orange = action only) | `bg-carup-action` + `text-carup-action-on`, `hover:bg-carup-action-hover`, soft `bg-carup-action-soft` with `text-carup-action-hover` |
| Status | `text-status-success` / `bg-status-success-soft`, same for `warning`, `danger`, `info`, `neutral` |
| Shape | `rounded-chrome` (2px), `rounded-control` (6px), `rounded-card` (12px); `shadow-sheet` only for sticky bars and sheets |
| Type | Inter 400/500/600/700 (`font-sans`), JetBrains Mono (`font-mono`) for VINs and references; body 14px/1.55; `tabular-nums` on money, mileage, counts |

Raw values: `var(--carup-color-*)`, `var(--carup-raw-*)`, spacing `var(--carup-space-1)`…`var(--carup-space-9)`
(4–48px). Composition: one primary action per region, photo first, open editorial bands, no glassmorphism,
no gradient glow, no cards nested in cards.

## Where the truth lives
`styles.css` → `_ds_bundle.css` holds every token and utility; each component's `<Name>.prompt.md` and
`<Name>.d.ts` hold its API and real examples. Read them before inventing styling.

## Example
```jsx
const { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter,
        Badge, Button, MoneyDisplay, TrustLens } = window.CarUp;

<Card className="w-[340px]">
  <CardHeader>
    <CardTitle>Toyota Hilux 2.8 GD-6 Raider</CardTitle>
    <CardDescription>2021 · 62,400 km · Harare</CardDescription>
    <CardAction><Badge variant="secondary">Dealer</Badge></CardAction>
  </CardHeader>
  <CardContent className="space-y-3">
    <MoneyDisplay amount={38500} currency="USD" source="asking" size="lg" />
    <TrustLens state="evaluated" sourceCount={3} freshness="12 Nov 2026" />
  </CardContent>
  <CardFooter className="gap-2">
    <Button className="flex-1">Contact seller</Button>
    <Button variant="outline">Save</Button>
  </CardFooter>
</Card>
```
