from pathlib import Path

path = Path('/tmp/o2-mobile-implementation.py')
text = path.read_text()
old = "re.subn(pattern, replacement, text, count=1, flags=re.S)"
new = "re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)"
if old not in text:
    raise SystemExit('expected remediation sub helper not found')
path.write_text(text.replace(old, new, 1))
