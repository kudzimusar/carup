#!/usr/bin/env python3
"""
CARUP-UX-REBUILD-01 · RX-01B-ICR01 · C02 machine-checkable WCAG 2.2 AA contrast checker.

Single source of truth for the shipped token palette. Re-run after any token change:
    python3 carup-contrast-check.py          # human summary
    python3 carup-contrast-check.py --json   # emit rx01b-contrast-matrix.json
    python3 carup-contrast-check.py --csv    # emit rx01b-contrast-matrix.csv
Exit code 0 = all shipped pairings pass AA (normal text >= 4.5:1); 1 = failure found.
"""
import sys, json, csv

def lum(hexc: str) -> float:
    hexc = hexc.lstrip('#')
    r, g, b = [int(hexc[i:i+2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def ratio(fg: str, bg: str) -> float:
    a, b = lum(fg), lum(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)

# --- Direction A "Ink Precision" — LIGHT surfaces (public + workbench body) ---
LIGHT = {
    "paper":        "#FAFAF7",
    "surface":      "#F1F1ED",
    "surface-2":    "#EBEBE5",
    "action-soft":  "#FBEADF",
    "ok-soft":      "#E7F3EB",
    "warn-soft":    "#FAF0E3",
    "danger-soft":  "#F9ECEC",
    "info-soft":    "#EAF0FD",
    "neutral-soft": "#EEF1F5",
    "text":         "#191D27",
    "text-2":       "#59616F",
    "text-3":       "#5A6572",   # ICR01 corrected (was #8A919D, 2.80-3.03:1)
    "action":       "#C2410C",
    "action-hover": "#9A3412",
    "ok":           "#166534",   # ICR01 corrected (was #15803D, 4.40:1)
    "warn":         "#92400E",   # ICR01 corrected (was #B45309, 4.46:1)
    "danger":       "#B91C1C",
    "info":         "#1D4ED8",
    "neutral":      "#475569",
}

# --- DARK body variant (optional; ink workspace chrome ships regardless) ---
DARK = {
    "dm-ink":     "#0B1526",
    "dm-ink-2":   "#13233D",
    "dm-work":    "#1D2A42",
    "dm-elev":    "#24344F",
    "dm-text":    "#F4F6F9",
    "dm-text-2":  "#C3CBD6",
    "dm-text-3":  "#9AA5B4",   # ICR01 final (passes on work 5.76 / elev 5.01 / ink 7.32)
    "dm-action":  "#FB7A3C",   # pending Owner swatch sign-off (see D-02 register)
    "dm-ok":      "#4ADE80",
    "dm-warn":    "#FBBF24",
    "dm-danger":  "#F87171",
    "dm-info":    "#93C5FD",
    "dm-neutral": "#A8B1BE",
}

# Every pairing the design system SHIPS. Anything not listed is not a sanctioned combination.
SHIPPED = [
    # light body text hierarchy
    ("light", "text", "paper"), ("light", "text", "surface"), ("light", "text", "surface-2"),
    ("light", "text-2", "paper"), ("light", "text-2", "surface"), ("light", "text-2", "surface-2"),
    ("light", "text-3", "paper"), ("light", "text-3", "surface"), ("light", "text-3", "surface-2"),
    # action: full strength only on neutral surfaces
    ("light", "action", "paper"), ("light", "action", "surface"),
    # action on its own tint uses the darker hover ink (hard rule, enforced in components)
    ("light", "action-hover", "action-soft"),
    # status labels sit on their soft tints
    ("light", "ok", "ok-soft"), ("light", "ok", "paper"),
    ("light", "warn", "warn-soft"), ("light", "warn", "paper"),
    ("light", "danger", "danger-soft"), ("light", "danger", "paper"),
    ("light", "info", "info-soft"), ("light", "info", "paper"),
    ("light", "neutral", "neutral-soft"), ("light", "neutral", "paper"),
    # dark body variant hierarchy
    ("dark-body", "dm-text", "dm-ink"), ("dark-body", "dm-text", "dm-work"), ("dark-body", "dm-text", "dm-elev"),
    ("dark-body", "dm-text-2", "dm-ink"), ("dark-body", "dm-text-2", "dm-work"), ("dark-body", "dm-text-2", "dm-elev"),
    ("dark-body", "dm-text-3", "dm-ink"), ("dark-body", "dm-text-3", "dm-work"), ("dark-body", "dm-text-3", "dm-elev"),
    # dark action + status inks on dark chrome (soft tints below are rgba of these on dm-ink-2)
    ("dark-body", "dm-action", "dm-ink"), ("dark-body", "dm-action", "dm-ink-2"), ("dark-body", "dm-action", "dm-work"),
    ("dark-body", "dm-ok", "dm-ink"), ("dark-body", "dm-warn", "dm-ink"),
    ("dark-body", "dm-danger", "dm-ink"), ("dark-body", "dm-info", "dm-ink"), ("dark-body", "dm-neutral", "dm-ink"),
]

PALETTES = {"light": LIGHT, "dark-body": DARK}
MIN_AA_NORMAL, MIN_AA_LARGE = 4.5, 3.0

def check():
    rows = []
    for mode, fg, bg in SHIPPED:
        pal = PALETTES[mode]
        r = round(ratio(pal[fg], pal[bg]), 2)
        rows.append({
            "mode": mode, "foreground": fg, "fg_hex": pal[fg],
            "background": bg, "bg_hex": pal[bg], "ratio": r,
            "wcag_aa_normal": r >= MIN_AA_NORMAL, "wcag_aa_large": r >= MIN_AA_LARGE,
        })
    return rows

def main():
    rows = check()
    fails = [x for x in rows if not x["wcag_aa_normal"]]
    if "--json" in sys.argv:
        print(json.dumps(rows, indent=1))
    elif "--csv" in sys.argv:
        w = csv.DictWriter(sys.stdout, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    else:
        for x in rows:
            flag = "PASS" if x["wcag_aa_normal"] else "FAIL"
            print(f"{flag}  {x['mode']:<10} {x['foreground']:<12} {x['fg_hex']}  on  {x['background']:<12} {x['bg_hex']}  = {x['ratio']}:1")
        print(f"\n{len(rows)} shipped pairings checked — {len(fails)} AA failures.")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
