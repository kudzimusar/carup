#!/bin/sh
# Byte-verify all 15 PR files against the f2f481d tree (git blob SHA).
set -e
cd "$(dirname "$0")/.."
cat > /tmp/expected-s15a.txt <<'SHAS'
8a6f951f3cd2abaf31da78f37114f221ec5ddfbd web/src/components/ux-prototype/rx02-s1-4a/contracts.ts
b8cf43b149673377fa61b9bd03dd4d3d64144cf0 web/src/components/ux-prototype/rx02-s1-4a/fixtures.ts
06a2a9741a400ef794716c1a5064629d001a1bad web/src/components/ux-prototype/rx02-s1-4a/navProjection.ts
9c5aab1bde51bd0bb855edfecec573feb4864857 web/src/components/ux-prototype/rx02-s1-4a/routeShellMap.ts
7489b26cf8942f59b52f561bd7bdd0415e39161e web/src/components/ux-prototype/rx02-s1-4a/BrandMark.tsx
de98de89ad4e73433a1e5b5e06d84ce7b6beca88 web/src/components/ux-prototype/rx02-s1-4a/fixtureDisplay.tsx
15ee1d06aac8078093b23659fc0304c0e5179164 web/src/components/ux-prototype/rx02-s1-4a/PublicShell.tsx
a412aa521e0078ec8e8323caf4978087ec9cbde0 web/src/components/ux-prototype/rx02-s1-4a/WorkspaceShell.tsx
7055f86de988cc3a7a925b3891aa80b9d4be0318 web/src/components/ux-prototype/rx02-s1-4a/FocusedShell.tsx
8caf503387fe38367e87a53d5a2b956f94279626 web/src/components/ux-prototype/rx02-s1-4a/pathUtils.ts
404648d889542ef3ec76482277efbf02261f232a web/src/components/ux-prototype/rx02-s1-4a/index.ts
30e2baa847e9577caa874d451ad5913213e64197 web/src/components/ux-prototype/rx02-s1-4a/shellPrototype.test.tsx
3fbb6288d5896a11a20eea09e55412e71d62486f web/src/pages/dev/Rx02S14ShellPrototype.tsx
0b5f885a99aa7836f620d61c279e622acd1c3f9d web/src/App.tsx
944bd494f53fefdb8abb906615da1784fd15e153 docs/product-experience/RX02_S1_4A_SHELL_PROTOTYPE.md
SHAS
ok=0; fail=0
while read -r want path; do
  got=$(git hash-object "$path")
  if [ "$got" = "$want" ]; then ok=$((ok+1)); else fail=$((fail+1)); echo "MISMATCH $path got=$got want=$want"; fi
done < /tmp/expected-s15a.txt
echo "VERIFY_OK=$ok VERIFY_FAIL=$fail"
[ "$fail" -eq 0 ]
