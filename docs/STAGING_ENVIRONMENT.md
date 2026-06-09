# Staging environment routing

How the staging frontend and backend are wired on Vercel (team `pay-pass-project`).

## Projects

| Role | Vercel project | URL |
| --- | --- | --- |
| Staging frontend | `carup-staging` | https://carup-staging.vercel.app |
| Staging backend | `carup-backend-staging` | https://carup-backend-staging.vercel.app (and the auto-canonical https://carup-backend-aca7.vercel.app) |
| Production frontend | `carup` | https://carup.vercel.app |
| Production backend | `carup-backend` | https://carup-backend.vercel.app |

The backend (`backend/server.js`) `export default app`s an Express app, which Vercel serves natively
(no `api/` wrapper or `backend/vercel.json`). Every backend route is mounted under `/api`, so the
frontend must target `<backend-origin>/api`.

## Frontend → backend resolution

`web/src/lib/apiClient.ts` `resolveApiBaseUrl(VITE_API_URL, hostname)`:

1. If `VITE_API_URL` is set, use it — normalized to end in `/api` (a bare origin like
   `https://host` is rewritten to `https://host/api`, so a missing suffix can't 404 every request).
2. Else, on a `localhost` host → same-origin `/api`.
3. Else (any other host, no override) → the production backend `DEFAULT_PRODUCTION_API_BASE_URL`.

Because of step 3, **the staging frontend must set `VITE_API_URL`** — otherwise it falls through to the
production backend.

## Required Vercel configuration (staging)

- **`carup-backend-staging` project** — add `carup-backend-staging.vercel.app` as a production domain
  so it serves the backend and is exempt from deployment protection (the project's canonical
  `carup-backend-aca7.vercel.app` is the auto-generated equivalent):

  ```sh
  vercel domains add carup-backend-staging.vercel.app --scope pay-pass-project   # linked to carup-backend-staging
  ```

- **`carup-staging` project** — set `VITE_API_URL` to the staging backend with the `/api` suffix:

  ```sh
  vercel env add VITE_API_URL production --value 'https://carup-backend-staging.vercel.app/api' --no-sensitive -y --scope pay-pass-project
  ```

  Then redeploy the frontend so the value is inlined into a fresh build:

  ```sh
  vercel redeploy https://carup-staging.vercel.app --scope pay-pass-project
  ```

> Note: `VITE_API_URL` must be added with `--no-sensitive` if you want to read it back with
> `vercel env pull` — Production/Preview vars default to sensitive (pull shows them empty otherwise).

## Verification

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://carup-backend-staging.vercel.app/api/health   # 200
curl -s https://carup-staging.vercel.app/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'         # bundle
# bundle should reference carup-backend-staging.vercel.app/api (the configured value wins; the lone
# carup-backend.vercel.app/api in the bundle is only the DEFAULT_PRODUCTION fallback constant).
```

CORS already allows the staging origin: `backend/config/corsOptions.js` matches
`carup-staging.vercel.app` via the `carup-...vercel.app` preview pattern, so no backend env change is
needed.

## Known follow-up

- **Preview env** on `carup-staging` is not set (the CLI requires an interactive git-branch choice for
  "all preview branches"). Production env covers `carup-staging.vercel.app`. To also route PR-preview
  builds of the staging project at the staging backend, set `VITE_API_URL` for Preview via the Vercel
  dashboard (Project → Settings → Environment Variables → Preview → all branches).
