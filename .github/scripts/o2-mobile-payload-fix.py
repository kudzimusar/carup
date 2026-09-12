from pathlib import Path

path = Path('/tmp/o2-mobile-implementation.py')
text = path.read_text()

replacements = {
    "re.subn(pattern, replacement, text, count=1, flags=re.S)":
        "re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)",
    "t = rep(t, header_old, header_new, 'workbook phone tabs')":
        "t = sub(t, r'''        \\{/\\* Wraps on purpose:.*?\\*/\\}\\n        <div className=\\\"flex flex-wrap items-center justify-between gap-2\\\">.*?\\n        </div>(?=\\n\\n        \\{tab === 'template')''', header_new, 'workbook phone tabs')",
    "t = rep(t, upload_old, upload_new, 'workbook upload control')":
        "t = sub(t, r'''            <div className=\\\"flex flex-wrap items-center gap-2\\\">\\n              <input type=\\\"file\\\" accept=\\\"\\.xlsx\\\".*?data-testid=\\\"wb-inspect\\\">.*?\\n              </Button>\\n            </div>''', upload_new, 'workbook upload control')",
}

for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'expected remediation payload fragment not found: {old[:60]}')
    text = text.replace(old, new, 1)

# The payload changes `parseImagePayload` into `export function
# parseVerificationPayload`, so the old bottom testable export entry must be
# removed. Re-exporting the new symbol there would be a duplicate ESM export.
text += """

p = 'backend/services/identity/verificationSessionService.js'
t = read(p)
t = rep(t, '  parseImagePayload,\\n', '', 'remove obsolete image parser export')
write(p, t)

# Mobile action-row replacement must keep JSX event braces independent from
# following props. The original payload accidentally put data-testid inside
# the onClick expression for Confirm mapping.
p = 'web/src/components/workbook/WorkbookWorkspace.tsx'
t = read(p)
t = rep(
    t,
    'onClick={() => void confirmMapping() data-testid="wb-confirm-mapping"',
    'onClick={() => void confirmMapping()} data-testid="wb-confirm-mapping"',
    'workbook confirm-mapping JSX closure',
)
write(p, t)
"""

path.write_text(text)
