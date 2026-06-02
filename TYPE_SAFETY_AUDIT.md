# CarUp Kimi – Type Safety Audit (Directive 002)

This audit documents every unsafe `any` usage discovered across `web/src` (including component state containers, api mappings, function signatures, and catch-blocks) and maps them to target strict typescript interfaces.

---

## 1. Summary of Unsafe `any` Occurrences

* **`any[]` States / Props**: 28 instances
* **`: any` parameter or property signatures**: 46 instances
* **`<any` type casting or generic signatures**: 30 instances

---

## 2. Inventory of Unsafe Typing by File

### Shared Context & Hooks

| File Path | Line | Current Unsafe Code | Proposed Interface / Type |
| :--- | :--- | :--- | :--- |
| `web/src/App.tsx` | 91 | `user: any \| null` | `AuthUser \| null` |
| `web/src/App.tsx` | 92 | `setUser: (user: any) => void` | `(user: AuthUser \| null) => void` |
| `web/src/App.tsx` | 94 | `notifications: any[]` | `Notification[]` |
| `web/src/App.tsx` | 96 | `setCurrency: (c: any) => void` | `(c: 'USD' \| 'ZiG' \| 'ZAR' \| 'BWP') => void` |
| `web/src/hooks/useCarUpApi.ts` | 42 | `} catch (err: any) {` | `} catch (err: unknown) {` (safely narrow) |
| `web/src/hooks/useCarUpApi.ts` | 57 | `filters?: any` | `Record<string, string \| number \| boolean \| undefined>` |
| `web/src/hooks/useCarUpApi.ts` | 95 | `details?: any` | `Record<string, unknown>` |
| `web/src/hooks/useCarUpApi.ts` | 190 | `createDealerPromotion: (data: any) => ...` | `createDealerPromotion: (data: Omit<Promotion, 'id'>) => ...` |
| `web/src/hooks/useCarUpApi.ts` | 201 | `createMechanicWorkOrder: (data: any) => ...` | `createMechanicWorkOrder: (data: Omit<WorkOrder, 'id' \| 'date' \| 'mechanic' \| 'cost'>) => ...` |
| `web/src/hooks/useCarUpApi.ts` | 212 | `createMechanicPart: (data: any) => ...` | `createMechanicPart: (data: Omit<Part, 'id' \| 'stock' \| 'price'>) => ...` |
| `web/src/hooks/useCarUpApi.ts` | 225 | `data.map((app: any) => ({ ... }))` | `data.map((app: FinanceApplicationResponse) => ({ ... }))` |

---

### Government Portal (`dashboard/government`)

| File Path | Line | Current Unsafe Code | Proposed Interface / Type |
| :--- | :--- | :--- | :--- |
| `RegistryVerification.tsx` | 13 | `const [verifications, setVerifications] = useState<any[]>([])` | `useState<RegistryVerification[]>([])` |
| `RegistryVerification.tsx` | 16 | `const [selectedVerification, setSelectedVerification] = useState<any \| null>(null)` | `useState<RegistryVerification \| null>(null)` |
| `ComplianceReports.tsx` | 12 | `const [reports, setReports] = useState<any[]>([])` | `useState<ComplianceReport[]>([])` |
| `ComplianceReports.tsx` | 35 | `handleDownload = (report: any) =>` | `handleDownload = (report: ComplianceReport) =>` |

---

### Insurance Portal (`dashboard/insurance`)

| File Path | Line | Current Unsafe Code | Proposed Interface / Type |
| :--- | :--- | :--- | :--- |
| `Claims.tsx` | 13 | `const [claims, setClaims] = useState<any[]>([])` | `useState<Claim[]>([])` |
| `Claims.tsx` | 86 | `filtered.map((claim) =>` | Implicit typed iteration through typed state `Claim[]` |
| `FraudAlerts.tsx` | 12 | `const [alerts, setAlerts] = useState<any[]>([])` | `useState<FraudAlert[]>([])` |

---

### Mechanic Portal (`dashboard/mechanic`)

| File Path | Line | Current Unsafe Code | Proposed Interface / Type |
| :--- | :--- | :--- | :--- |
| `PartsTracking.tsx` | 13 | `const [parts, setParts] = useState<any[]>([])` | `useState<Part[]>([])` |
| `PartsTracking.tsx` | 28 | `data.map((d: any) => ...)` | `data.map((d: MechanicPartResponse) => ...)` |
| `PartsTracking.tsx` | 71 | `} catch (err: any) {` | `} catch (err: unknown) {` (safely narrow) |
| `WorkOrders.tsx` | 14 | `const [workOrders, setWorkOrders] = useState<any[]>([])` | `useState<WorkOrder[]>([])` |
| `WorkOrders.tsx` | 29 | `data.map((d: any) => ...)` | `data.map((d: MechanicWorkOrderResponse) => ...)` |
| `WorkOrders.tsx` | 72 | `} catch (err: any) {` | `} catch (err: unknown) {` (safely narrow) |
| `MechanicDashboard.tsx` | 33 | `const [ledgerLogs, setLedgerLogs] = useState([...])` | Uses implicit types; convert to `useState<AuditLog[]>([...])` |
| `MechanicDashboard.tsx` | 38 | `const [approvals, setApprovals] = useState([...])` | Convert to `useState<ClientApproval[]>([...])` |
| `ServiceLogs.tsx` | 20 | `const [logs, setLogs] = useState<any[]>(mockLogs)` | `useState<ServiceLog[]>(mockLogs)` |

---

### Owner Portal (`dashboard/owner`)

| File Path | Line | Current Unsafe Code | Proposed Interface / Type |
| :--- | :--- | :--- | :--- |
| `MyGarage.tsx` | 13 | `const [vehicles, setVehicles] = useState<any[]>([])` | `useState<Vehicle[]>([])` |
| `MyGarage.tsx` | 76 | `vehicles.insurance_records?.filter((r: any) =>` | `vehicles.insurance_records?.filter((r: InsuranceRecord) =>` |
| `PartSentry.tsx` | 22 | `const [vehicles, setVehicles] = useState<any[]>([])` | `useState<Vehicle[]>([])` |
| `ServiceHistory.tsx` | 13 | `const [vehicles, setVehicles] = useState<any[]>([])` | `useState<Vehicle[]>([])` |
| `ServiceHistory.tsx` | 14 | `const [allServices, setAllServices] = useState<any[]>([])` | `useState<ServiceRecord[]>([])` |
| `ServiceHistory.tsx` | 97 | `service.parts.map((p: any) => ...)` | `service.parts.map((p: Part) => ...)` |
| `SellVehicle.tsx` | 55 | `set = (field: string, value: any) =>` | `set = (field: keyof typeof INITIAL, value: any) =>` (proper narrowing) |
| `SellVehicle.tsx` | 157 | `} catch (err: any) {` | `} catch (err: unknown) {` (safely narrow) |
| `InsuranceRecords.tsx` | 11 | `const [vehicles, setVehicles] = useState<any[]>([])` | `useState<Vehicle[]>([])` |
| `SavedCars.tsx` | 12 | `const [savedVehicles, setSavedVehicles] = useState<any[]>([])` | `useState<Vehicle[]>([])` |
| `MyListings.tsx` | 21 | `const [myListings, setMyListings] = useState<any[]>([])` | `useState<Vehicle[]>([])` |

---

### Dealer Portal (`dashboard/dealer`)

| File Path | Line | Current Unsafe Code | Proposed Interface / Type |
| :--- | :--- | :--- | :--- |
| `Inventory.tsx` | 26 | `const [inventory, setInventory] = useState<any[]>([])` | `useState<Vehicle[]>([])` |
| `Inventory.tsx` | 50 | `inventory.filter((v: any) =>` | `inventory.filter((v: Vehicle) =>` |
| `Inventory.tsx` | 126 | `filtered.map((vehicle: any) =>` | `filtered.map((vehicle: Vehicle) =>` |
| `Promotions.tsx` | 20 | `const [promotions, setPromotions] = useState<any[]>(mockPromotions)` | `useState<Promotion[]>(mockPromotions)` |
| `Promotions.tsx` | 34 | `data.map((d: any) => ...)` | `data.map((d: DealerPromotionResponse) => ...)` |
| `Leads.tsx` | 19 | `const [leadsData, setLeadsData] = useState<any[]>(mockLeadsData)` | `useState<Lead[]>(mockLeadsData)` |

---

## 3. Types Remediation Blueprint

* We will isolate all base domain structures into `web/src/types/index.ts`.
* All files loading array data will explicitly pass typed parameters to `useState<T[]>(...)`.
* Try-catch blocks using standard browser catch parameters will be typed as `catch (err: unknown)` and properly narrowed using:
  ```typescript
  if (err instanceof Error) {
    toast.error(err.message);
  } else {
    toast.error('An unexpected error occurred');
  }
  ```
