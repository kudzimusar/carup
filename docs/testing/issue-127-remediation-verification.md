# Issue #127 bounded remediation verification

Tested source head: `85c8c54efce15067a1fa745db8ef5ff40bd07a0f`

> The repository-wide lint command remains red on unrelated pre-existing files (152 findings in the prior run). The lint gate below is deliberately scoped to every web file changed by this remediation branch.

| Gate | Exit code | Result |
|---|---:|---|
| Dependency install | 0 | PASS |
| Targeted Vitest | 0 | PASS |
| Changed-file lint | 1 | FAIL |
| Production web build | 0 | PASS |
| Backend syntax | 0 | PASS |

## Targeted test tail
```text

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.8 [39m[90m/home/runner/work/carup/carup/web[39m

 [32m✓[39m src/lib/userNotifications.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 31[2mms[22m[39m
 [32m✓[39m src/pages/diaspora/DiasporaDriveConnections.test.tsx [2m([22m[2m10 tests[22m[2m)[22m[33m 425[2mms[22m[39m
 [32m✓[39m src/pages/diaspora/DiasporaRequestLoopRegression.test.tsx [2m([22m[2m3 tests[22m[2m)[22m[33m 338[2mms[22m[39m
 [32m✓[39m src/lib/diasporaDocumentChecklist.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32m✓[39m src/lib/authorizedPortalRoles.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32m✓[39m src/lib/pendingReturnTo.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 5[2mms[22m[39m

[2m Test Files [22m [1m[32m6 passed[39m[22m[90m (6)[39m
[2m      Tests [22m [1m[32m25 passed[39m[22m[90m (25)[39m
[2m   Start at [22m 07:33:13
[2m   Duration [22m 3.97s[2m (transform 696ms, setup 583ms, import 1.68s, tests 812ms, environment 6.17s)[22m

```

## Changed-file lint tail
```text

/home/runner/work/carup/carup/web/src/App.tsx
  168:14  error  Fast refresh only works when a file only exports components. Move your React context(s) to a separate file                      react-refresh/only-export-components
  177:14  error  Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components  react-refresh/only-export-components

/home/runner/work/carup/carup/web/src/components/layout/Navbar.tsx
  145:7  error  Error: Calling setState synchronously within an effect can trigger cascading renders

Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:
* Update external systems with the latest state from React.
* Subscribe for updates from some external system, calling setState in a callback function when external state changes.

Calling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect).

/home/runner/work/carup/carup/web/src/components/layout/Navbar.tsx:145:7
  143 |   useEffect(() => {
  144 |     if (!user) {
> 145 |       setUserNotifications([])
      |       ^^^^^^^^^^^^^^^^^^^^ Avoid calling setState() directly within an effect
  146 |       return
  147 |     }
  148 |     let cancelled = false  react-hooks/set-state-in-effect

/home/runner/work/carup/carup/web/src/pages/NotificationCenter.tsx
  36:47  error  Error: Calling setState synchronously within an effect can trigger cascading renders

Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:
* Update external systems with the latest state from React.
* Subscribe for updates from some external system, calling setState in a callback function when external state changes.

Calling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect).

/home/runner/work/carup/carup/web/src/pages/NotificationCenter.tsx:36:47
  34 |
  35 |   useEffect(() => {
> 36 |     if (!authLoading && isAuthenticated) void load()
     |                                               ^^^^ Avoid calling setState() directly within an effect
  37 |   }, [authLoading, isAuthenticated, load])
  38 |
  39 |   if (!authLoading && !isAuthenticated) {  react-hooks/set-state-in-effect

✖ 4 problems (4 errors, 0 warnings)

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
[2mdist/[22m[2massets/[22m[36mFeatureGovernanceConsole-B6x02zMs.js  [39m[1m[2m   33.81 kB[22m[1m[22m[2m │ gzip:   8.43 kB[22m
[2mdist/[22m[2massets/[22m[36mindex-Bkbtl_mb.js                     [39m[1m[33m2,576.75 kB[39m[22m[2m │ gzip: 665.64 kB[22m
[33m
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[32m✓ built in 11.16s[39m
```

## Backend syntax tail
```text
```

