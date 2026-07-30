# Issue #127 bounded remediation verification

Tested source head: `37c128e67765ec025d9b3ac98a2b6c12fbc2b8bd`

| Gate | Exit code | Result |
|---|---:|---|
| Dependency install | 0 | PASS |
| Targeted Vitest | 0 | PASS |
| Web lint | 1 | FAIL |
| Production web build | 2 | FAIL |
| Backend syntax | 0 | PASS |

## Targeted test tail
```text

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.8 [39m[90m/home/runner/work/carup/carup/web[39m

 [32m✓[39m src/lib/userNotifications.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 52[2mms[22m[39m
 [32m✓[39m src/pages/diaspora/DiasporaRequestLoopRegression.test.tsx [2m([22m[2m3 tests[22m[2m)[22m[33m 345[2mms[22m[39m
 [32m✓[39m src/pages/diaspora/DiasporaDriveConnections.test.tsx [2m([22m[2m10 tests[22m[2m)[22m[33m 444[2mms[22m[39m
 [32m✓[39m src/lib/diasporaDocumentChecklist.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 5[2mms[22m[39m
 [32m✓[39m src/lib/authorizedPortalRoles.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m

[2m Test Files [22m [1m[32m5 passed[39m[22m[90m (5)[39m
[2m      Tests [22m [1m[32m22 passed[39m[22m[90m (22)[39m
[2m   Start at [22m 07:29:42
[2m   Duration [22m 3.79s[2m (transform 673ms, setup 494ms, import 1.62s, tests 852ms, environment 5.14s)[22m

```

## Lint tail
```text
  21:6   warning  React Hook useEffect has a missing dependency: 'loadClaims'. Either include it or remove the dependency array                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              react-hooks/exhaustive-deps
  28:14  error    'error' is defined but never used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          @typescript-eslint/no-unused-vars
  40:14  error    'error' is defined but never used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          @typescript-eslint/no-unused-vars

/home/runner/work/carup/carup/web/src/pages/dashboard/insurance/FraudAlerts.tsx
  17:5   error    Error: Cannot access variable before it is declared

`loadAlerts` is accessed before it is declared, which prevents the earlier access from updating when this value changes over time.

/home/runner/work/carup/carup/web/src/pages/dashboard/insurance/FraudAlerts.tsx:17:5
  15 |
  16 |   useEffect(() => {
> 17 |     loadAlerts()
     |     ^^^^^^^^^^ `loadAlerts` accessed before it is declared
  18 |   }, [])
  19 |
  20 |   const loadAlerts = async () => {

/home/runner/work/carup/carup/web/src/pages/dashboard/insurance/FraudAlerts.tsx:20:3
  18 |   }, [])
  19 |
> 20 |   const loadAlerts = async () => {
     |   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
> 21 |     try {
     | ^^^^^^^^^
> 22 |       setLoading(true)
     …
     | ^^^^^^^^^
> 29 |     }
     | ^^^^^^^^^
> 30 |   }
     | ^^^^ `loadAlerts` is declared here
  31 |
  32 |   const handleResolve = async (id: string) => {
  33 |     try {  react-hooks/immutability
  18:6   warning  React Hook useEffect has a missing dependency: 'loadAlerts'. Either include it or remove the dependency array                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          react-hooks/exhaustive-deps
  25:14  error    'error' is defined but never used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      @typescript-eslint/no-unused-vars
  37:14  error    'error' is defined but never used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      @typescript-eslint/no-unused-vars

/home/runner/work/carup/carup/web/src/pages/dashboard/insurance/RiskAnalysis.tsx
  45:14  error  'err' is defined but never used  @typescript-eslint/no-unused-vars

/home/runner/work/carup/carup/web/src/pages/dashboard/owner/AIDashboard.tsx
  54:233  error  Unnecessary escape character: \-  no-useless-escape

/home/runner/work/carup/carup/web/src/pages/dashboard/owner/MyListings.tsx
  18:17  error  Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components  react-refresh/only-export-components
  22:17  error  Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components  react-refresh/only-export-components
  26:17  error  Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components  react-refresh/only-export-components
  31:17  error  Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components  react-refresh/only-export-components

/home/runner/work/carup/carup/web/src/pages/dashboard/owner/SavedCars.tsx
  18:5  error  Error: Calling setState synchronously within an effect can trigger cascading renders

Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:
* Update external systems with the latest state from React.
* Subscribe for updates from some external system, calling setState in a callback function when external state changes.

Calling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect).

/home/runner/work/carup/carup/web/src/pages/dashboard/owner/SavedCars.tsx:18:5
  16 |   useEffect(() => {
  17 |     let active = true
> 18 |     setLoading(true)
     |     ^^^^^^^^^^ Avoid calling setState() directly within an effect
  19 |     setError(null)
  20 |     fetchSavedMarketplaceListings()
  21 |       .then((response) => {  react-hooks/set-state-in-effect

/home/runner/work/carup/carup/web/src/pages/dashboard/shared/TrustReviewQueue.tsx
  166:7  error    Error: Calling setState synchronously within an effect can trigger cascading renders

Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:
* Update external systems with the latest state from React.
* Subscribe for updates from some external system, calling setState in a callback function when external state changes.

Calling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect).

/home/runner/work/carup/carup/web/src/pages/dashboard/shared/TrustReviewQueue.tsx:166:7
  164 |   useEffect(() => {
  165 |     if (factFilter !== 'all' && !allowedFacts.includes(factFilter)) {
> 166 |       setFactFilter('all')
      |       ^^^^^^^^^^^^^ Avoid calling setState() directly within an effect
  167 |     }
  168 |   }, [allowedFacts, factFilter])
  169 |  react-hooks/set-state-in-effect
  193:7  error    Error: Calling setState synchronously within an effect can trigger cascading renders

Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs. In general, the body of an effect should do one or both of the following:
* Update external systems with the latest state from React.
* Subscribe for updates from some external system, calling setState in a callback function when external state changes.

Calling setState synchronously within an effect body causes cascading renders that can hurt performance, and is not recommended. (https://react.dev/learn/you-might-not-need-an-effect).

/home/runner/work/carup/carup/web/src/pages/dashboard/shared/TrustReviewQueue.tsx:193:7
  191 |   useEffect(() => {
  192 |     if (!authLoading && isReviewer) {
> 193 |       loadQueue()
      |       ^^^^^^^^^ Avoid calling setState() directly within an effect
  194 |     }
  195 |   }, [authLoading, isReviewer, status, factFilter])
  196 |                            react-hooks/set-state-in-effect
  195:6  warning  React Hook useEffect has a missing dependency: 'loadQueue'. Either include it or remove the dependency array                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           react-hooks/exhaustive-deps

/home/runner/work/carup/carup/web/src/types/index.ts
    77:18  error  An interface declaring no members is equivalent to its supertype  @typescript-eslint/no-empty-object-type
    79:18  error  An interface declaring no members is equivalent to its supertype  @typescript-eslint/no-empty-object-type
  1254:11  error  Unexpected any. Specify a different type                          @typescript-eslint/no-explicit-any
  1424:18  error  An interface declaring no members is equivalent to its supertype  @typescript-eslint/no-empty-object-type

✖ 152 problems (143 errors, 9 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

npm error Lifecycle script `lint` failed with error:
npm error code 1
npm error path /home/runner/work/carup/carup/web
npm error workspace carup-web@0.0.0
npm error location /home/runner/work/carup/carup/web
npm error command failed
npm error command sh -c eslint .
```

## Build tail
```text

> carup-monorepo@1.0.0 build
> npm run build --workspace=web


> carup-web@0.0.0 build
> tsc -b && vite build

src/pages/diaspora/DiasporaTrade.tsx(659,14): error TS2304: Cannot find name 'requiredDocuments'.
src/pages/diaspora/DiasporaTrade.tsx(659,37): error TS7006: Parameter 'documentName' implicitly has an 'any' type.
src/pages/diaspora/DiasporaTrade.tsx(659,51): error TS7006: Parameter 'index' implicitly has an 'any' type.
npm error Lifecycle script `build` failed with error:
npm error code 2
npm error path /home/runner/work/carup/carup/web
npm error workspace carup-web@0.0.0
npm error location /home/runner/work/carup/carup/web
npm error command failed
npm error command sh -c tsc -b && vite build
```

## Backend syntax tail
```text
```
