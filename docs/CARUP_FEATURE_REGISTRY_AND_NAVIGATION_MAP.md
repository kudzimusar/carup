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

## Selector Functions

```ts
// Get all features for a role
getFeaturesByRole(role: UserRole): FeatureRegistryItem[]

// Get sidebar items for a role's dashboard
getDashboardItems(role: UserRole): FeatureRegistryItem[]

// Get features by UI placement
getFeaturesByPlacement(placement: NavPlacement): FeatureRegistryItem[]

// Get features by product domain
getFeaturesByDomain(domain: FeatureDomain): FeatureRegistryItem[]

// Check role access to a feature
canAccessFeature(featureId: string, role: UserRole): boolean

// Get dashboard root route for a role
getDashboardRoute(role: UserRole): string

// Get role display metadata (title, color, dashboardRoute)
getRoleMetadata(role: UserRole): RoleMetadata

// Get all registered roles
getAllRoles(): UserRole[]
```

## How to Add a New Feature

1. Add a `FeatureRegistryItem` entry to the `FEATURE_REGISTRY` array in `featureRegistry.ts`.
2. Set the appropriate `roles`, `placements`, and `domain`.
3. The feature will automatically appear in the correct sidebar/nav.
4. If the feature needs a new route, add the route definition in `App.tsx`.
5. Update this documentation with the new feature entry.

## Consistency Rules

1. **All dashboard sidebar items** must be registered in `FEATURE_REGISTRY`.
2. **All role dashboard routes** must be defined in `ROLE_METADATA`.
3. **Never hardcode** dashboard routes or nav items in components — use selectors.
4. **Icon names** must match entries in the `ICON_MAP` in `DashboardLayout.tsx`.
5. **The `bank` role** must be included everywhere other roles appear (it was historically missing from Navbar).
