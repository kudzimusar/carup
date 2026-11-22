/**
 * Tailwind config for the Claude Design sync CSS (.design-sync/build-ds.mjs).
 *
 * Reuses the web app's own config (theme, token extension, plugins, dark mode) and widens
 * `content`:
 *  - all of web/src, so the class vocabulary the design agent sees is what CarUp's screens use;
 *  - the authored previews in .design-sync/previews;
 *  - a safelist of the token colour utilities, so every `carup-*` / `status-*` token is usable.
 *
 * TAILWIND v4 SYNTAX COMPATIBILITY (found during the 2026-11-15 sync).
 * The shadcn primitives in web/src/components/ui are written in Tailwind v4 syntax, but the app
 * compiles them with tailwindcss 3.4, which silently emits NOTHING for v4-only spellings. In the
 * live app that means: invalid controls keep a grey border, the Calendar collapses (~150px),
 * Radix menus show the browser focus outline, disabled InputOTP does not dim, etc. This config
 * teaches 3.4 the v4 spellings the DS uses, so the synced design system renders as the components
 * intend. It does NOT change the app - the same gaps remain in production until the app's own
 * Tailwind build adopts an equivalent fix (reported as an RX03-P1 finding).
 * Not covered (minor, recorded in NOTES.md): container queries (@container, @md/...), the v4 `!`
 * important suffix, and `**:` / `*:[span]` selector variants.
 */
const path = require('node:path')
const plugin = require('tailwindcss/plugin')
const base = require('../web/tailwind.config.js')

const TOKEN_COLOR_UTILITIES = /^(bg|text|border|ring|outline|fill|stroke|divide|decoration|placeholder|from|via|to)-(carup|status)-.+$/

// v4 `(--var)` shorthand -> theme keys named exactly that, so `h-(--cell-size)` and every variant of it resolve.
const v = (...names) => Object.fromEntries(names.map((n) => [`(${n})`, `var(${n})`]))
const baseExtend = base.theme?.extend ?? {}

module.exports = {
  ...base,
  content: [
    path.join(__dirname, '../web/index.html'),
    path.join(__dirname, '../web/src/**/*.{js,ts,jsx,tsx}'),
    path.join(__dirname, 'previews/**/*.{ts,tsx}'),
  ],
  safelist: [...(base.safelist ?? []), { pattern: TOKEN_COLOR_UTILITIES }],
  theme: {
    ...base.theme,
    extend: {
      ...baseExtend,
      aria: { ...(baseExtend.aria ?? {}), invalid: 'invalid="true"' },
      height: { ...(baseExtend.height ?? {}), ...v('--cell-size') },
      size: { ...(baseExtend.size ?? {}), ...v('--cell-size') },
      width: { ...(baseExtend.width ?? {}), ...v('--cell-size', '--sidebar-width', '--sidebar-width-icon') },
      minWidth: { ...(baseExtend.minWidth ?? {}), ...v('--cell-size') },
      maxWidth: { ...(baseExtend.maxWidth ?? {}), ...v('--skeleton-width') },
      padding: { ...(baseExtend.padding ?? {}), ...v('--cell-size') },
      maxHeight: {
        ...(baseExtend.maxHeight ?? {}),
        ...v('--radix-select-content-available-height', '--radix-dropdown-menu-content-available-height', '--radix-context-menu-content-available-height'),
      },
      transformOrigin: {
        ...(baseExtend.transformOrigin ?? {}),
        ...v(
          '--radix-select-content-transform-origin', '--radix-dropdown-menu-content-transform-origin',
          '--radix-context-menu-content-transform-origin', '--radix-menubar-content-transform-origin',
          '--radix-popover-content-transform-origin', '--radix-hover-card-content-transform-origin',
          '--radix-tooltip-content-transform-origin',
        ),
      },
      backgroundColor: { ...(baseExtend.backgroundColor ?? {}), ...v('--color-bg') },
      borderColor: { ...(baseExtend.borderColor ?? {}), ...v('--color-border') },
    },
  },
  plugins: [
    ...(base.plugins ?? []),
    plugin(({ addBase, addUtilities, addVariant, matchVariant, addComponents }) => {
      // v4 defines `--spacing` (the base step) on :root; Alert's `calc(var(--spacing)*4)` icon column needs it.
      addBase({ ':root': { '--spacing': '0.25rem' } })
      addUtilities({
        '.outline-hidden': { outline: '2px solid transparent', 'outline-offset': '2px' },
        '.field-sizing-content': { 'field-sizing': 'content' },
      })
      addVariant('has-disabled', '&:has(:disabled)')
      addVariant('has-focus', '&:has(:focus)')
      matchVariant('has-data', (value) => `&:has([data-${value}])`)
      matchVariant('in-data', (value) => `:where([data-${value}]) &`)
      // `[--cell-size:--spacing(8)]` (a v4 function) compiles to an invalid value in 3.4; spacing(8) = 2rem.
      addComponents({ '[data-slot="calendar"][class]': { '--cell-size': '2rem' } })
    }),
  ],
}
