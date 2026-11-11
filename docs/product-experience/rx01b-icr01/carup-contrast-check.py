#!/usr/bin/env python3
"""
CARUP-UX-REBUILD-01 · RX-01B-ICR01 · C02 machine-checkable WCAG 2.2 AA contrast checker.

S0-corrected methodology (review finding PR #260 discussion_r4534685312):
dark status / action "soft" backgrounds are SEMITRANSPARENT TINTS
(rgba(status_ink, 0.12) and rgba(251,122,60, 0.14)) specified OVER `#13233D`
(token contract UI_DESIGN_REFERENCE_AND_TOKENS.md §1.2–1.3). Contrast for those
pairings is computed against the ALPHA-COMPOSITED OPAQUE RESULT, not against
`dm-ink` (#0B1526). Direct-on-surface pairings (ink on dm-ink / work / elev)
are unchanged.

Single source of truth for the shipped token palette. Re-run after any token change:
    python3 carup-contrast-check.py          # human summary (shipped + regression gate)
    python3 carup-contrast-check.py --json   # emit rx01b-contrast-matrix.json (shipped rows only)
    python3 carup-contrast-check.py --csv    # emit rx01b-contrast-matrix.csv  (shipped rows only)

Exit code 0 = every SHIPPED pairing passes AA (normal text >= 4.5:1) AND every
REGRESSION pairing (deliberately weakened ink) is REJECTED. Exit 1 otherwise.
The regression gate proves the checker rejects any ratio below 4.5:1 — a weakened
token cannot slip through silently.
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

def composite(ink_hex: str, alpha: float, base_hex: str) -> str:
    """Alpha-composite `ink_hex` at `alpha` over opaque `base_hex` -> opaque hex."""
    ink = [int(ink_hex[i:i+2], 16) for i in (1, 3, 5)]
    base = [int(base_hex[i:i+2], 16) for i in (1, 3, 5)]
    out = [round(alpha * x + (1 - alpha) * y) for x, y in zip(ink, base)]
    return "#%02X%02X%02X" % tuple(out)

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
    "dm-action":  "#FB7A3C",   # pending Owner swatch sign-off (see D-07 register)
    "dm-ok":      "#4ADE80",
    "dm-warn":    "#FBBF24",
    "dm-danger":  "#F87171",
    "dm-info":    "#93C5FD",
    "dm-neutral": "#A8B1BE",
}

# Semtransparent dark soft tints per token contract §1.2-1.3:
#   status soft bg = rgba(status_ink, 0.12) on #13233D
#   action soft bg = rgba(251,122,60, 0.14) on #13233D
DARK_SOFT_BASE = "#13233D"
DARK_SOFT = {
    "dm-ok-soft":      ("dm-ok", 0.12),
    "dm-warn-soft":    ("dm-warn", 0.12),
    "dm-danger-soft":  ("dm-danger", 0.12),
    "dm-info-soft":    ("dm-info", 0.12),
    "dm-neutral-soft": ("dm-neutral", 0.12),
    "dm-action-soft":  ("dm-action", 0.14),
}

def bg_for(mode: str, name: str) -> str:
    """Resolve a background name to its OPAQUE hex (compositing dark soft tints)."""
    if mode == "light":
        return LIGHT[name]
    if name in DARK:
        return DARK[name]
    ink_name, alpha = DARK_SOFT[name]
    return composite(DARK[ink_name], alpha, DARK_SOFT_BASE)

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
    # dark action + status inks directly on dark chrome surfaces
    ("dark-body", "dm-action", "dm-ink"), ("dark-body", "dm-action", "dm-ink-2"), ("dark-body", "dm-action", "dm-work"),
    ("dark-body", "dm-ok", "dm-ink"), ("dark-body", "dm-warn", "dm-ink"),
    ("dark-body", "dm-danger", "dm-ink"), ("dark-body", "dm-info", "dm-ink"), ("dark-body", "dm-neutral", "dm-ink"),
    # dark status inks on their COMPOSITED soft tints (S0 methodology)
    ("dark-body", "dm-ok", "dm-ok-soft"),
    ("dark-body", "dm-warn", "dm-warn-soft"),
    ("dark-body", "dm-danger", "dm-danger-soft"),
    ("dark-body", "dm-info", "dm-info-soft"),
    ("dark-body", "dm-neutral", "dm-neutral-soft"),
    # dark action on its COMPOSITED soft tint: full-strength #FB7A3C stays mandatory —
    # the darker #9A3412 ink FAILS on the dark tint (1.78:1), unlike the light-mode rule.
    ("dark-body", "dm-action", "dm-action-soft"),
]

# Deliberately weakened pairings that MUST be REJECTED (< 4.5:1). Proves the gate bites.
REGRESSION = [
    ("dark-body", "#E45E5E", "dm-danger-soft"),  # weakened danger ink: 3.89:1 on composited tint
]

PALETTES = {"light": LIGHT, "dark-body": DARK}
MIN_AA_NORMAL, MIN_AA_LARGE = 4.5, 3.0

def fg_for(mode: str, name_or_hex: str) -> str:
    pal = PALETTES[mode]
    return pal.get(name_or_hex, name_or_hex)

def check():
    rows = []
    for mode, fg, bg in SHIPPED:
        fg_hex, bg_hex = fg_for(mode, fg), bg_for(mode, bg)
        r = round(ratio(fg_hex, bg_hex), 2)
        rows.append({
            "mode": mode, "foreground": fg, "fg_hex": fg_hex,
            "background": bg, "bg_hex": bg_hex, "ratio": r,
            "wcag_aa_normal": r >= MIN_AA_NORMAL, "wcag_aa_large": r >= MIN_AA_LARGE,
        })
    return rows

def check_regression():
    rows = []
    for mode, fg_hex, bg in REGRESSION:
        bg_hex = bg_for(mode, bg)
        r = round(ratio(fg_hex, bg_hex), 2)
        rows.append({
            "mode": mode, "foreground": fg_hex, "fg_hex": fg_hex,
            "background": bg, "bg_hex": bg_hex, "ratio": r,
            "rejected": r < MIN_AA_NORMAL,
        })
    return rows

def main():
    rows = check()
    reg = check_regression()
    fails = [x for x in rows if not x["wcag_aa_normal"]]
    escapes = [x for x in reg if not x["rejected"]]  # regression that passed = gate failure
    if "--json" in sys.argv:
        print(json.dumps(rows, indent=1))
    elif "--csv" in sys.argv:
        w = csv.DictWriter(sys.stdout, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    else:
        for x in rows:
            flag = "PASS" if x["wcag_aa_normal"] else "FAIL"
            print(f"{flag}  {x['mode']:<10} {x['foreground']:<12} {x['fg_hex']}  on  {x['background']:<16} {x['bg_hex']}  = {x['ratio']}:1")
        print("\nREGRESSION GATE (deliberately weakened inks — each must be REJECTED < 4.5:1):")
        for x in reg:
            flag = "REJECTED ✓" if x["rejected"] else "ESCAPED ✗"
            print(f"  {flag}  {x['fg_hex']} on {x['background']} ({x['bg_hex']}) = {x['ratio']}:1")
        print(f"\n{len(rows)} shipped pairings checked — {len(fails)} AA failures; "
              f"{len(reg)} regression case(s) — {len(escapes)} escaped.")
    sys.exit(1 if (fails or escapes) else 0)

if __name__ == "__main__":
    main()
