# CarUp Feature Registry & Navigation Map

> **Source of truth**: [`web/src/config/featureRegistry.ts`](../web/src/config/featureRegistry.ts)

This document describes the centralized Feature Registry architecture that governs CarUp's navigation, route discovery, and role-based feature access.

## Architecture

The Feature Registry is a single typed array of `FeatureRegistryItem` entries in `featureRegistry.ts`. Every dashboard sidebar item, user menu link, and role-specific feature is registered exactly once. Navigation components (`Navbar.tsx`, `DashboardLayout.tsx`) consume the registry via selector functions instead of maintaining their own duplicate data.

```
featureRegistry.ts  ←── Single source of truth
    │
    ├── DashboardLayout.tsx  (sidebar items via getDashboardItems)
    ├── Navbar.tsx           (dashboard routes via getDashboardRoute)
    └── Future consumers     (mobile nav, footer, AI, etc.)
```

## Registry Schema

```ts
interface FeatureRegistryItem {
  id: string            // Unique key: 'role.feature' (e.g. 'owner.garage')
  label: string         // Display name in navigation
  route: string         // URL path
  domain: FeatureDomain // Product domain category
  roles: UserRole[]     // Which roles can access
  placements: NavPlacement[] // Where this appears in UI
  requiresAuth: boolean // Whether login is required
  icon: LucideIconName  // Lucide icon component name
  badge?: string|number // Optional badge text or count
  description?: string  // Tooltip / a11y description
}
```

### Domains

| Domain | Description |
|--------|-------------|
| `commerce` | Marketplace, listings, buying/selling |
| `trust` | Trust scoring, trust review queues |
| `evidence` | Evidence vault, evidence review |
| `safepay` | SafePay/escrow/reservation features |
| `parts` | PartSentry, parts tracking |
| `service` | Work orders, service logs, mechanic tools |
| `insurance` | Insurance claims, risk, fraud |
| `government` | Registry verification, compliance |
| `diaspora` | Import orders, diaspora trade |
| `admin` | User management, moderation, AI monitoring |
| `finance` | Bank lending, collateral, credit risk |
| `info` | Help, blog, about, contact |

### Placements

| Placement | Description |
|-----------|-------------|
| `dashboard_sidebar` | Role-specific dashboard sidebar navigation |
| `header` | Global header / navbar |
| `footer` | Site footer |
| `mobile_nav` | Mobile hamburger menu |
| `user_menu` | Authenticated user dropdown |

## Role Metadata

| Role | Title | Dashboard Route | Color |
|------|-------|----------------|-------|
| `owner` | Car Owner | `/dashboard` | `bg-blue-500` |
| `dealer` | Dealer | `/dealer` | `bg-purple-500` |
| `mechanic` | Mechanic | `/mechanic` | `bg-emerald-500` |
| `insurance` | Insurance | `/insurance-dash` | `bg-rose-500` |
| `government` | Government | `/government` | `bg-amber-500` |
| `admin` | Administrator | `/admin` | `bg-red-500` |
| `bank` | Banker | `/bank` | `bg-indigo-600` |

## Role → Feature Matrix

### Owner Dashboard (11 items)
| Feature | Route | Domain | Icon |
|---------|-------|--------|------|
| Overview | `/dashboard` | commerce | LayoutDashboard |
| My Garage | `/dashboard/garage` | commerce | Car |
| Evidence Vault | `/dashboard/garage` | evidence | FileText |
| Service History | `/dashboard/service-history` | service | Wrench |
| Insurance | `/dashboard/insurance` | insurance | Shield |
| PartSentry | `/dashboard/partsentry` | parts | Gauge |
| Import Orders | `/diaspora/imports` | diaspora | FileText |
| Start Import Order | `/diaspora/imports/new` | diaspora | ClipboardList |
| My Listings | `/dashboard/listings` | safepay | Tag |
| Saved Cars | `/dashboard/saved` | commerce | Heart |
| Gutu AI | `/dashboard/ai` | commerce | MessageSquare |

### Dealer Dashboard (6 items)
| Feature | Route | Domain |
|---------|-------|--------|
| Overview | `/dealer` | commerce |
| Inventory | `/dealer/inventory` | commerce |
| Leads | `/dealer/leads` | commerce |
| Promotions | `/dealer/promotions` | commerce |
| Analytics | `/dealer/analytics` | commerce |
| Evidence Review | `/dealer/evidence` | evidence |

### Mechanic Dashboard (5 items)
| Feature | Route | Domain |
|---------|-------|--------|
| Overview | `/mechanic` | service |
| Work Orders | `/mechanic/work-orders` | service |
| Service Logs | `/mechanic/service-logs` | service |
| Parts Tracking | `/mechanic/parts` | parts |
| Customers | `/mechanic/customers` | service |

### Insurance Dashboard (4 items)
| Feature | Route | Domain |
|---------|-------|--------|
| Overview | `/insurance-dash` | insurance |
| Claims | `/insurance-dash/claims` | insurance |
| Risk Analysis | `/insurance-dash/risk` | insurance |
| Fraud Alerts | `/insurance-dash/fraud` | insurance |

### Government Dashboard (6 items)
| Feature | Route | Domain |
|---------|-------|--------|
| Overview | `/government` | government |
| Registry Verification | `/government/registry` | government |
| Compliance | `/government/compliance` | government |
| Diaspora Compliance | `/admin/diaspora/compliance` | diaspora |
| Evidence Review | `/government/evidence` | evidence |
| Trust Review | `/government/trust-review` | trust |

### Admin Dashboard (7 items)
| Feature | Route | Domain |
|---------|-------|--------|
| Overview | `/admin` | admin |
| Users | `/admin/users` | admin |
| AI Monitoring | `/admin/ai` | admin |
| Moderation | `/admin/moderation` | admin |
| Evidence Review | `/admin/evidence` | evidence |
| Trust Review | `/admin/trust-review` | trust |
| Diaspora Compliance | `/admin/diaspora/compliance` | diaspora |

### Bank Dashboard (4 items)
| Feature | Route | Domain |
|---------|-------|--------|
| Overview | `/bank` | finance |
| Lending Queue | `/bank/applications` | finance |
| Collateral Map | `/bank/collateral` | finance |
| Credit Risk Analysis | `/bank/risk` | finance |

## Selector & Access Guard Functions

```ts
// ── Core Selectors (Phase 1) ──────────────────────────────────────────────
getFeaturesByRole(role: UserRole): FeatureRegistryItem[]
getDashboardItems(role: UserRole): FeatureRegistryItem[]
getFeaturesByPlacement(placement: NavPlacement): FeatureRegistryItem[]
getFeaturesByDomain(domain: FeatureDomain): FeatureRegistryItem[]
canAccessFeature(featureId: string, role: UserRole): boolean
getDashboardRoute(role: UserRole): string
getRoleMetadata(role: UserRole): RoleMetadata
getAllRoles(): UserRole[]

// ── Public Navigation & Access Guard (Phase 2) ─────────────────────────────
getPublicNavigationItems(): FeatureRegistryItem[]
getPublicFooterItems(section: 'Product' | 'Company' | 'Resources'): FeatureRegistryItem[]
matchRoutePattern(pattern: string, path: string): boolean
getFeatureByRoute(route: string): FeatureRegistryItem | undefined
isPublicRoute(route: string): boolean
isProtectedRoute(route: string): boolean
getAllowedRolesForRoute(route: string): UserRole[]
canRoleAccessRoute(role: UserRole, route: string): boolean
getDefaultRouteForRole(role: UserRole): string
```

---

## Migration Status & Coverage Matrix

| Surface | Registry-Backed? | Implementation Notes |
|:---|:---:|:---|
| **Dashboard Sidebar** | Yes | Driven dynamically via `getDashboardItems(role)`. |
| **Navbar Direct Links** | Yes | Driven dynamically via `getPublicNavigationItems()`. |
| **Footer (Product/Company/Resources)** | Yes | Driven dynamically via `getPublicFooterItems(section)`. |
| **Footer Stakeholder Links** | Yes | Dynamically built using `getAllRoles()` (ensures Bank role is automatically synced). |
| **Navbar Dropdowns (Buy/Sell/Verify/Parts/More)** | No | *Intentionally not migrated yet*. These dropdown menus require custom nested structures (`MenuSection[]` shape) and deep link parameter logic. |

---

## How-To Guides

### How to Add a New Dashboard Feature
1. Add a new `FeatureRegistryItem` to `FEATURE_REGISTRY` in `featureRegistry.ts`.
2. Configure `requiresAuth: true`.
3. Under `roles`, list the role names that have access to this feature.
4. Under `placements`, include `'dashboard_sidebar'`.
5. Ensure its `route` matches a route declared under the corresponding layout guard in `App.tsx`.

### How to Add a New Public Navigation Link
1. Add a new `FeatureRegistryItem` to `FEATURE_REGISTRY` in `featureRegistry.ts`.
2. Set `requiresAuth: false`, and keep `roles: []`.
3. Under `placements`, add `'header'`.
4. The link will automatically render on the desktop header bar.

### How to Add a Footer Link
1. Add a new `FeatureRegistryItem` to `FEATURE_REGISTRY` in `featureRegistry.ts`.
2. Set `requiresAuth: false`, and keep `roles: []`.
3. Under `placements`, add `'footer'`.
4. Ensure the item `id` is prefixed with the category namespace (e.g. `product.marketplace-list`, `company.about-us`, `resources.help-desk`). The prefix determines the column placement.

### How to Add a Stakeholder Role
1. Add the role to the `UserRole` union type in `@shared/types` (e.g. `partner`).
2. Add its display title, theme color, and default route to `ROLE_METADATA` in `featureRegistry.ts`.
3. Add the role's default dashboard route to `App.tsx`.
4. The role will automatically appear in the dashboard dropdown selector, the navbar role switcher, and the public footer stakeholders column.

---

## Consistency & Route Safety Rules

1. **Route Mirroring**: Every route registered in `FEATURE_REGISTRY` must correspond to a `<Route>` declared in `App.tsx`.
2. **Access Guards**: Page routes must not rely on component-level checks; use `canRoleAccessRoute(role, route)` to align route guards.
3. **Plural Nouns**: Stakeholder footer links are automatically pluralized based on their role metadata title via a translation helper in `Footer.tsx`. Ensure any new role title maps correctly.
4. **Parameterized Routes**: Parameterized paths in the registry must use standard colon format (e.g. `:id`) to ensure `matchRoutePattern` functions correctly.
