# CORE ARCHITECTURE DISCOVERY AUDIT

This audit report delivers the complete technical discovery phase for **Directive 003C – Core Architecture Track**, detailing the exact type structures, occurrences of `any`, and hidden compiler errors in the core layout files:
* `web/src/App.tsx`
* `web/src/components/layout/Navbar.tsx`
* `web/src/components/layout/DashboardLayout.tsx`

---

## 1. Type Safety Inventory

### Explicit `any` and `any[]` Declarations
Our recursive search identified exactly **4 occurrences** of explicit `any` across the core files, all located in a single block inside `App.tsx`:

| File | Line | Context / Code Block | Current Variable / Declaration | Target Clean Type |
| :--- | :--- | :--- | :--- | :--- |
| `web/src/App.tsx` | 91 | `interface AppContextType` | `user: any \| null` | `AuthUser \| null` (from `@shared/types`) |
| `web/src/App.tsx` | 92 | `interface AppContextType` | `setUser: (user: any) => void` | `(user: AuthUser \| null) => void` |
| `web/src/App.tsx` | 94 | `interface AppContextType` | `notifications: any[]` | `Notification[]` (from `@shared/types`) |
| `web/src/App.tsx` | 96 | `interface AppContextType` | `setCurrency: (c: any) => void` | `(c: 'USD' \| 'ZiG' \| 'ZAR' \| 'BWP') => void` |

> [!NOTE]
> `web/src/components/layout/Navbar.tsx` and `web/src/components/layout/DashboardLayout.tsx` contain **zero** explicit `: any` or `any[]` statements. Their `@ts-nocheck` directives were used to bypass compiler warnings/errors rather than hiding untyped variables.

---

## 2. Core Architecture Types Identification

### A. Context Types
The global application context `AppContext` in `web/src/App.tsx` has the following signature:

```typescript
// Current signature in App.tsx:
interface AppContextType {
  user: any | null
  setUser: (user: any) => void
  isAuthenticated: boolean
  notifications: any[]
  currency: 'USD' | 'ZiG' | 'ZAR' | 'BWP'
  setCurrency: (c: any) => void
}

// Proposed clean type definitions for AppContextType:
import type { AuthUser, Notification } from '@shared/types'

interface AppContextType {
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
  isAuthenticated: boolean
  notifications: Notification[]
  currency: 'USD' | 'ZiG' | 'ZAR' | 'BWP'
  setCurrency: (c: 'USD' | 'ZiG' | 'ZAR' | 'BWP') => void
}
```

### B. User & Role Types
The layouts rely on the Auth layer from `web/src/context/AuthContext.tsx` which returns a strongly-typed `AuthContextType`:
* **User**: `AuthUser | null`
* **UserRole**: `'owner' | 'dealer' | 'mechanic' | 'bank' | 'insurance' | 'government' | 'admin'` (Strict Union from `@shared/types`)

```typescript
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  avatar?: string;
  active_tenant_id?: string | null;
}
```

### C. Navigation & Menu Item Types
The layout menus are structured into role-based items. The types are defined inline:

* **Navbar Desktop/Mobile Links**:
  ```typescript
  interface NavLink {
    label: string;
    href: string;
    icon: React.ElementType; // Lucide Icon component
  }
  ```
* **Dashboard Sidebar Items**:
  ```typescript
  interface NavItem {
    label: string;
    href: string;
    icon: React.ElementType; // Lucide Icon component
    badge?: string | number;
  }
  ```
* **Role Mappings**:
  - `roleNavItems: Record<string, NavItem[]>`
  - `roleLabels: Record<string, { title: string; color: string }>`

### D. Notification Types
Notifications are consumed in `Navbar.tsx` from mock data where they are strictly defined:
```typescript
export interface Notification {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}
```

---

## 3. Temporary Compiler Audit Results

To uncover what `@ts-nocheck` was masking, we temporarily removed `// @ts-nocheck` from `Navbar.tsx` and `DashboardLayout.tsx` and ran a strict compiler type check via `npx tsc --noEmit --project tsconfig.app.json`.

### Captured Compiler Errors
Exactly **4 errors** were caught in the entire layout check, all belonging to the **Implicit/Unused Locals category (TS6133)**:

```text
src/components/layout/DashboardLayout.tsx(17,3): error TS6133: 'ChevronRight' is declared but its value is never read.
src/components/layout/DashboardLayout.tsx(24,3): error TS6133: 'Building2' is declared but its value is never read.
src/components/layout/DashboardLayout.tsx(35,1): error TS6133: 'useApp' is declared but its value is never read.
src/components/layout/Navbar.tsx(20,3): error TS6133: 'User' is declared but its value is never read.
```

### Analysis of the Clean Audit Result
> [!TIP]
> The absolute lack of type mismatches, implicit `any`s, or object access violations is an excellent finding. 
> Because the layouts retrieve `user` from `useAuth()` (which is already fully typed to `AuthUser | null`) and notifications from `mockData` (which is already typed as `Notification[]`), there is **no hidden type debt** under `@ts-nocheck`. 
> 
> The `@ts-nocheck` comment was primarily masking simple unused import errors that fail strict validation (`noUnusedLocals: true`).

---

## 4. Remediation Risk & Impact Classification

### Scope & Effort Estimation
* **Total files**: 3 (`App.tsx`, `Navbar.tsx`, `DashboardLayout.tsx`)
* **Remediation Risk Level**: **Very Low**
* **Technical Effort**: **Minimal** (under 1 hour)
* **Estimated Lines of Code Changed**: ~15 lines

### Verification Plan (Directive 003D)
* **Compiler Validation**:
  ```bash
  npx tsc --noEmit --project tsconfig.app.json
  ```
* **Production Build Validation**:
  ```bash
  npm run build
  ```
* **Manual UI Check**: Ensure the global offline syncing banner, layout roles, dynamic role switches, notifications badge, and navbar dropdown elements function cleanly with zero visual changes.

---

## 5. Conclusion & Decision Gate

The architecture discovery pass is now complete. The files have been restored to their original state, leaving the git directory completely clean. 

**Decision**: The remaining type debt is incredibly clean and easily remediated. We are ready to proceed directly to **Directive 003D – Core Architecture Remediation** upon your approval.
