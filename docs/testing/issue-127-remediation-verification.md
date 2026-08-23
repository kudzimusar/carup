# Issue #127 bounded remediation verification

Tested source head: `f336cc15b12117d19b5140bc825905da89bd52e3`

> The repository-wide lint command remains red on unrelated pre-existing files (152 findings in the baseline run). Every file changed by this remediation is linted here. `App.tsx` is checked with only its pre-existing Fast Refresh context-export rule disabled; all other lint rules remain enabled.

| Gate | Exit code | Result |
|---|---:|---|
| Dependency install | 0 | PASS |
| Targeted Vitest | 0 | PASS |
| Changed-file lint | 0 | PASS |
| Production web build | 0 | PASS |
| Backend syntax | 0 | PASS |

## Targeted test tail
```text

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.8 [39m[90m/home/runner/work/carup/carup/web[39m

 [32m✓[39m src/pages/diaspora/DiasporaRequestLoopRegression.test.tsx [2m([22m[2m3 tests[22m[2m)[22m[33m 317[2mms[22m[39m
 [32m✓[39m src/pages/diaspora/DiasporaDriveConnections.test.tsx [2m([22m[2m10 tests[22m[2m)[22m[33m 409[2mms[22m[39m
 [32m✓[39m src/pages/diaspora/DiasporaTradeProfile.requests.test.tsx [2m([22m[2m12 tests[22m[2m)[22m[33m 904[2mms[22m[39m
 [32m✓[39m src/lib/userNotifications.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 33[2mms[22m[39m
 [32m✓[39m src/pages/diaspora/DiasporaTradeProfile.organization.test.tsx [2m([22m[2m2 tests[22m[2m)[22m[32m 133[2mms[22m[39m
 [32m✓[39m src/lib/diasporaDocumentChecklist.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32m✓[39m src/lib/pendingReturnTo.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 7[2mms[22m[39m
 [32m✓[39m src/lib/authorizedPortalRoles.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 7[2mms[22m[39m

[2m Test Files [22m [1m[32m8 passed[39m[22m[90m (8)[39m
[2m      Tests [22m [1m[32m39 passed[39m[22m[90m (39)[39m
[2m   Start at [22m 07:37:08
[2m   Duration [22m 5.40s[2m (transform 885ms, setup 737ms, import 2.85s, tests 1.82s, environment 7.83s)[22m

```

## Changed-file lint tail
```text
```

## Production build tail
```text

> carup-monorepo@1.0.0 build
> npm run build --workspace=web


> carup-web@0.0.0 build
> tsc -b && vite build

[36mvite v7.3.5 [32mbuilding client environment for production...[36m[39m
transforming...
[32m✓[39m 2713 modules transformed.
rendering chunks...
computing gzip size...
[2mdist/[22m[32mindex.html                                   [39m[1m[2m    0.50 kB[22m[1m[22m[2m │ gzip:   0.32 kB[22m
[2mdist/[22m[2massets/[22m[35mindex-BtpfoJi7.css                    [39m[1m[2m  198.59 kB[22m[1m[22m[2m │ gzip:  33.32 kB[22m
[2mdist/[22m[2massets/[22m[36mFeatureGovernanceConsole-CFbXYImL.js  [39m[1m[2m   33.81 kB[22m[1m[22m[2m │ gzip:   8.43 kB[22m
[2mdist/[22m[2massets/[22m[36mindex-BiifrvR5.js                     [39m[1m[33m2,576.75 kB[39m[22m[2m │ gzip: 665.63 kB[22m
[33m
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[32m✓ built in 10.68s[39m
```

## Backend syntax tail
```text
```

