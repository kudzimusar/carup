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

path.write_text(text)
