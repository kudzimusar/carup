/**
 * CARUP-DEALER-1.0-VISUAL-UAT-MERGE-01 — Owner UAT defect D1.
 * The shared Button never wraps (`whitespace-nowrap`), so a long dealership action label such as
 * "Upload completed workbook and populate application" was wider than a 390px phone and pushed the
 * whole page sideways (61px horizontal scroll). Long dealership labels opt into wrapping instead;
 * short labels and icon buttons are untouched.
 */
export const DEALER_WRAP_BUTTON = 'h-auto min-h-9 max-w-full whitespace-normal text-center leading-snug'
/** Same for `size="sm"` buttons (keeps their 32px minimum height). */
export const DEALER_WRAP_BUTTON_SM = 'h-auto min-h-8 max-w-full whitespace-normal text-center leading-snug'
