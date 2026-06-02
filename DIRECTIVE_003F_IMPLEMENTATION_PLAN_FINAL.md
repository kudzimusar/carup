# DIRECTIVE 003F — FINAL IMPLEMENTATION PLAN

This document outlines the finalized, verified execution plan for **Directive 003F — Owner Portal Type Remediation**. Every action is backed by dynamic verification logs of SQLite/Supabase schema types, timeline event models, and local mockup variables.

---

## 1. Schema Upgrades & Types Addition

### [MODIFY] [types/index.ts](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/types/index.ts)

Add/extend the following definitions exactly to bridge mocked files and database schemas cleanly:

```typescript
import type { 
  AuthUser as SharedAuthUser, 
  Vehicle as SharedVehicle,
  Escrow as SharedEscrow,
  Notification as SharedNotification
} from '@shared/types';

// 1. Extend Vehicle model with Client-Side Optional Associations
export interface Vehicle extends SharedVehicle {
  image_url?: string;
  images?: string[];
  condition?: string;
  category?: string;
  viewCount?: number;
  trustScore?: number;
  isVerified?: boolean;
  insurance_records?: InsuranceRecord[];
  service_history?: ServiceRecord[];
  escrows?: Escrow[];
}

// 2. Define Bridged InsuranceRecord supporting both mock camelCase & DB snake_case
export interface InsuranceRecord {
  id: string;
  provider: string;
  policyNumber?: string;
  policy_number?: string;
  type: string;
  startDate?: string;
  start_date?: string;
  expiryDate?: string;
  expiry_date?: string;
  premium: number;
  currency?: string;
  status: 'active' | 'expired' | 'pending' | string;
  coverage: string[];
}

// 3. Define Bridged Notification
export interface Notification extends SharedNotification {
  timestamp?: string; // Supporting mock schema
}

// 4. Export Escrow directly from Shared
export interface Escrow extends SharedEscrow {}

// 5. Extend Part schema to support visual type badges
export interface Part {
  id: string;
  name: string;
  sku: string;
  stock: number;
  type?: 'OEM' | 'Aftermarket' | 'Used' | string; // Added to prevent PartSentry mapping errors
  stock_level?: number;
  minStock?: number;
  min_stock?: number;
  supplier?: string;
  price: number;
  unit_price?: number;
  installedDate?: string;
  installedBy?: string;
  warranty?: string;
  cost?: number;
  blockchainHash?: string;
}

// 6. Define VehiclePassport response structure
export interface VehiclePassport {
  vehicle: Vehicle;
  timeline?: {
    id: string;
    event_source: 'service' | 'registry' | 'escrow' | string;
    label: string;
    timestamp: string;
    details?: {
      notes?: string;
      mileage?: number;
      cost?: number;
      [key: string]: any;
    };
  }[];
  trustReport?: {
    trustScore: number;
  };
  chainVerification?: {
    verified: boolean;
    integrity?: string;
  };
}
```

---

## 2. API hook Abstraction Boundary Resolution

To preserve hook encapsulation, we **REJECT** exposing `request` publicly. Instead, we define strongly-typed endpoints inside `useCarUpApi.ts`:

### [MODIFY] [useCarUpApi.ts](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/hooks/useCarUpApi.ts)

* Add endpoints:
  ```typescript
  const createVehicleListing = useCallback(async (payload: any): Promise<any> => {
    return request('/vehicles/add', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }, [request])

  const uploadVehicleImages = useCallback(async (vin: string, images: string[]): Promise<{ urls: string[] }> => {
    return request('/media/upload/vehicle', {
      method: 'POST',
      body: JSON.stringify({ vin, images })
    })
  }, [request])
  ```
* Include `createVehicleListing` and `uploadVehicleImages` in the returned object.

---

## 3. Sequential Page Refactoring

### Phase 1 — Lowest Risk

1. **`SavedCars.tsx`**: Remove `@ts-nocheck` and update state `useState<Vehicle[]>([])`.
2. **`MyListings.tsx`**: Remove `@ts-nocheck` and update state `useState<Vehicle[]>([])`.
3. **`AIDashboard.tsx`**: Remove `@ts-nocheck` and prune unused local hooks.

### Phase 2 — Low Risk

4. **`ServiceHistory.tsx`**: 
   * Remove `@ts-nocheck`.
   * Update states: `useState<Vehicle[]>([])` and `useState<WorkOrder[]>([])`.
   * Type variable mapping parameter `p: Part` on parts list.
   * Prune unused imports (`CardHeader`, `CardTitle`, `FileText`).
5. **`InsuranceRecords.tsx`**:
   * Remove `@ts-nocheck`.
   * Update state `useState<Vehicle[]>([])`.
   * Type mapping callbacks: `record: InsuranceRecord` and `r: InsuranceRecord`.
   * Prune unused imports (`CardHeader`, `CardTitle`, `Calendar`, `FileText`, `CheckCircle`).

### Phase 3 — Medium Risk

6. **`MyGarage.tsx`**:
   * Remove `@ts-nocheck`.
   * Update state `useState<Vehicle[]>([])`.
   * Type parameter callback `r: InsuranceRecord` inside active policies count.
   * Prune unused import `AlertTriangle`.

### Phase 4 — High Risk Dependency Fix

7. **`SellVehicle.tsx`**:
   * Remove `@ts-nocheck`.
   * Replace destructuring `const { request } = useCarUpApi()` $\rightarrow$ `const { createVehicleListing, uploadVehicleImages } = useCarUpApi()`.
   * Update media uploads to call `await uploadVehicleImages(form.vin, form.images)` and list submission to call `await createVehicleListing(payload)`.
   * Type callback `value: string | number | boolean` and `catch (err: unknown)` (with Type Guard narrow).
   * Prune unused `Car` import.

### Phase 5 — Vehicle Passport Foundation

8. **`VehicleProfile.tsx`**:
   * Remove `@ts-nocheck`.
   * Type passport state: `const [passportData, setPassportData] = useState<VehiclePassport | null>(null)`.
   * Map timeline variables to strongly-typed callback parameters instead of `e: any` to fully eliminate the 45 `never` type errors.
   * Prune unused imports (`CardHeader`, `CardTitle`, `Settings2`, `Fuel`).

### Phase 6 — Dashboard Core

9. **`OwnerDashboard.tsx`**:
   * Remove `@ts-nocheck`.
   * Update states: `vehicles: Vehicle[]` and `liveNotifications: Notification[]`.
   * Type escrow reducer parameter: `e: Escrow`.
   * Correct Button custom size `"xs"` $\rightarrow$ `"sm"` (Line 161).
   * Prune unused imports (`Input`, `AlertTriangle`, `TrendingUp`, `Clock`, `RefreshCw`, `stats` state).
10. **`PartSentry.tsx`**:
    * Remove `@ts-nocheck`.
    * Update state `vehicles: Vehicle[]`.
    * Re-type static parts list: `const [parts, setParts] = useState<Part[]>(STATIC_PARTS)`.
    * Prune unused imports (`Gauge`, `Hash`, `fetchVehiclePassport`).

---

## 4. Verification Check Gate

After modifying each page, we run:
```bash
npx tsc --noEmit --project tsconfig.app.json
```
And after completing each Phase, we run:
```bash
npm run build
```
This ensures complete code stability and zero regressions!
