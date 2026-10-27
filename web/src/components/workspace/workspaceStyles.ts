/**
 * R3 — the Seller workspace design grammar, extracted ONCE.
 *
 * The Owner selected the Seller workspace language as the visual model for new CarUp design. These
 * are the fragments that language is built from, each recorded with the reference surface it was
 * read from, so a reviewer can check the extraction instead of trusting it. Components in this
 * folder compose them; pages do not paste their own copies.
 *
 * What is deliberately ABSENT is as much of the contract as what is here: no blur or glass, no
 * rounded-card fleets, no floating-pill navigation, no gradients as decoration, no new font and no
 * new colour — navy/slate plus orange on white, hairline separators, square controls.
 *
 * Reference surfaces (line numbers are as of the R3 base, f4b12b60, before R3 touched them):
 *   H = components/seller/SellerWorkspaceHeader.tsx
 *   G = pages/dashboard/owner/MyGarage.tsx
 *   S = pages/dashboard/owner/SellVehicle.tsx   (the stage hero and its grid)
 *   L = pages/dashboard/owner/MyListings.tsx    (its square outline controls)
 * A token marked "from" is copied; "derived" combines two reference treatments and says which.
 */
export const WS_STYLE = {
  /** H:36 — the small, tracked, uppercase, orange line above a title. */
  eyebrow: 'text-[10px] font-black uppercase tracking-[0.22em] text-orange-600',
  /** G:180 — the quieter eyebrow used on a data row. */
  eyebrowQuiet: 'text-[10px] font-black uppercase tracking-[0.2em] text-slate-400',
  /** G:200 — the label inside a `gap-px` information grid. */
  gridLabel: 'text-[10px] font-black uppercase tracking-[0.16em] text-slate-400',
  /** G:201 — the value under a grid label. */
  gridValue: 'mt-2 text-sm font-bold text-slate-800',
  /** G:198 — hairline-divided information grid: 1px of slate-200 showing between white cells. */
  grid: 'grid gap-px bg-slate-200',
  gridCell: 'bg-white px-4 py-4',
  /** H:37 / G:183 — display heading: black weight, tight tracking. */
  display: 'font-black tracking-[-0.045em] text-slate-950',
  /** H:28 — the one focus treatment: orange ring with an offset, never the default outline. */
  focus: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2',
  /** H:28 — a parent / back link: 44px target, quiet until hovered. */
  quietLink: 'inline-flex min-h-11 items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-950',
  /** G:265 — the primary action: square, slate-950, orange on hover. */
  primaryAction: 'min-h-11 rounded-none bg-slate-950 px-6 font-black text-white hover:bg-orange-600',
  /** G:108 — the accent primary action. */
  accentAction: 'min-h-11 rounded-none bg-orange-600 font-black text-white hover:bg-orange-700',
  /** Derived from G:281 (the hairline-bordered control) and L:392 (rounded-none outline buttons): square, hairline border, no fill. */
  secondaryAction: 'inline-flex min-h-11 items-center gap-2 rounded-none border border-slate-300 px-5 text-sm font-bold text-slate-700 hover:border-slate-950 hover:text-slate-950',
  /** H:43 — the orange rule that marks a status line. */
  statusRule: 'border-l-2 border-orange-500 pl-3',
  /** G:121 — an honest "could not read" band: it never reads as an empty state. */
  unavailable: 'border-y border-amber-200 bg-amber-50 px-5 py-6',
  /** S:1067 — the deliberate dark stage panel (used sparingly; chrome does not use it). */
  stage: 'bg-[#07111f] text-white',
} as const
