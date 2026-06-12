# Diaspora Trade Frontend Discovery

## Current App Structure

- Router: `web/src/App.tsx` uses React Router route groups under `MainLayout` for public pages and `DashboardLayout` for stakeholder dashboards.
- Layouts: public routes use `MainLayout`; role-specific operational pages use `DashboardLayout`.
- Auth/session: `web/src/context/AuthContext.tsx` reads `carup_user` and `carup_token` from `localStorage`, exposes `useAuth()`, and passes `x-session-token`, `x-user-id`, `x-stakeholder-role`, and `x-tenant-id` through the API hook.
- API client: `web/src/hooks/useCarUpApi.ts` centralizes gateway calls and selects `http://localhost:5001/api` on localhost, otherwise `https://carup-backend.vercel.app/api`.
- Role-based UI: dashboard routes are grouped by role and some pages, such as Trust Review, perform in-page authorization checks from `user.role`.
- Tests: Playwright E2E tests live in `web/e2e`; unit tests use Vitest where present. Playwright expects a Vite dev server at `http://localhost:5173`.
- `data-testid`: existing coverage is strongest on tested flows such as marketplace, vehicle detail, trust review, owner dashboard, and auth forms.

## Existing Diaspora UI Search

No pre-existing dedicated Diaspora Trade UI routes were found under `web/src` before this slice. Existing matches were backend routes/services, dashboard compliance language, and marketplace/import-duty references.

Searched terms:

- `diaspora`
- `import order`
- `trade documents`
- `container booking`
- `shipment`
- `Zimbabwe ready`
- `government footprint`

## Buyer Import Order Route Plan

- `/diaspora`: buyer entry point and current order access.
- `/diaspora/imports`: buyer import order list.
- `/diaspora/imports/new`: new import order form.
- `/diaspora/imports/:id`: order detail, timeline, and required document checklist placeholder.
- `/diaspora/imports/:id/documents`: order-scoped trade document checklist/list.
- `/diaspora/imports/:id/shipment`: order-scoped shipment placeholder.
- `/admin/diaspora/compliance`: admin/government compliance placeholder guarded from normal buyers.

## Backend Endpoints Used

- `GET /api/diaspora/import-orders`
- `POST /api/diaspora/import-orders`
- `GET /api/diaspora/import-orders/:id`
- `GET /api/diaspora/import-orders/:id/documents`
- `GET /api/diaspora/compliance`

## Testability Standard

Every new route root, form field, button, status badge, timeline item, checklist item, and document row added for Diaspora Trade must include a stable `data-testid`.
