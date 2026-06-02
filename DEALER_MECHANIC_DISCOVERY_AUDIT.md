# DEALER + MECHANIC PORTAL DISCOVERY AUDIT REPORT

This document presents the technical findings of our **Type Safety Discovery Audit** for the Dealer and Mechanic portals under **Directive 004A**. Every target page has been compiled with and without the `@ts-nocheck` directive to catalog the exact type debt and compiler errors.

---

## 1. Audit Summary Matrix

| Portal | File Path | ts-nocheck | any[] | : any | Compiler Errors | Risk Level |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Dealer** | [Inventory.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/dealer/Inventory.tsx) | Yes | 1 | 2 | 5 | Medium (Boundary) |
| **Dealer** | [DealerDashboard.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/dealer/DealerDashboard.tsx) | Yes | 1 | 0 | 8 | Low (Indexing) |
| **Dealer** | [SalesAnalytics.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/dealer/SalesAnalytics.tsx) | No | 0 | 2 | 0 | None (Pruning) |
| **Mechanic** | [MechanicDashboard.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/mechanic/MechanicDashboard.tsx) | Yes | 0 | 0 | 4 | Low (UI Polish) |
| **Mechanic** | [CustomerRecords.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/mechanic/CustomerRecords.tsx) | Yes | 0 | 0 | 0 | None (Clean) |
| **Mechanic** | [ServiceLogs.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/mechanic/ServiceLogs.tsx) | No | 1 | 1 | 0 | None (Standard) |
| **TOTALS** | **6 Files Audited** | **4** | **3** | **5** | **17** | — |

---

## 2. Detailed Findings by File

### A. Dealer Portal Pages

#### 1. [DealerDashboard.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/dealer/DealerDashboard.tsx)
* **Type Debt**:
  - `@ts-nocheck` present at line 1
  - `any[]` at Line 31 (`useState<any[]>([])`)
* **Compilation Failures (Without `// @ts-nocheck`)**:
  - `web/src/pages/dashboard/dealer/DealerDashboard.tsx(3,1): error TS6133: 'Button' is declared but its value is never read.`
  - `web/src/pages/dashboard/dealer/DealerDashboard.tsx(8,39): error TS6133: 'Star' is declared but its value is never read.`
  - `web/src/pages/dashboard/dealer/DealerDashboard.tsx(8,57): error TS6133: 'Plus' is declared but its value is never read.`
  - `web/src/pages/dashboard/dealer/DealerDashboard.tsx(9,11): error TS6133: 'CheckCircle' is declared but its value is never read.`
  - `web/src/pages/dashboard/dealer/DealerDashboard.tsx(9,45): error TS6133: 'Shield' is declared but its value is never read.`
  - `web/src/pages/dashboard/dealer/DealerDashboard.tsx(57,12): error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'BranchPermissions'.` (at lines 57, 58, and 180).
* **Technical Remediation Plan**:
  - Remove `@ts-nocheck` directive.
  - Prune the 5 unused imports.
  - Type `liveInventory` state as `useState<Vehicle[]>([])`.
  - Type the `permissions` state explicitly to resolve string-indexing issues:
    ```typescript
    interface BranchPermissions {
      pricing: Record<string, boolean>;
      escrow: Record<string, boolean>;
      listings: Record<string, boolean>;
      [key: string]: Record<string, boolean>;
    }
    ```

#### 2. [Inventory.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/dealer/Inventory.tsx)
* **Type Debt**:
  - `@ts-nocheck` present at line 1
  - `any[]` at Line 26 (`useState<any[]>([])`)
  - `: any` at Line 50 (`(v: any)`) and Line 126 (`(vehicle: any)`)
* **Compilation Failures (Without `// @ts-nocheck`)**:
  - `web/src/pages/dashboard/dealer/Inventory.tsx(2,29): error TS6133: 'CardHeader' is declared but its value is never read.`
  - `web/src/pages/dashboard/dealer/Inventory.tsx(2,41): error TS6133: 'CardTitle' is declared but its value is never read.`
  - `web/src/pages/dashboard/dealer/Inventory.tsx(6,1): error TS6192: All imports in import declaration are unused.` (Dialog imports)
  - `web/src/pages/dashboard/dealer/Inventory.tsx(8,63): error TS6133: 'X' is declared but its value is never read.`
  - `web/src/pages/dashboard/dealer/Inventory.tsx(24,33): error TS2339: Property 'request' does not exist on type 'useCarUpApi()'.`
* **Technical Remediation Plan (CRITICAL BOUNDARY RESOLUTION)**:
  > [!IMPORTANT]
  > Line 59 attempts to destructure and invoke the low-level `request()` helper directly to update a vehicle status: `PATCH /vehicles/:vin/status`. 
  > 
  > Exposing `request()` publicly to pages violates hook encapsulation. Instead of exposing `request()`, we will **re-use the existing, public strongly-typed hook action** `updateVehicleStatus(vin, status)` already exported by `useCarUpApi()`. This fully preserves the clean API boundary!
  - Remove `@ts-nocheck` directive.
  - Prune the unused imports (CardHeader, CardTitle, Dialog imports, and X).
  - Type `inventory` state as `useState<Vehicle[]>([])`.
  - Type callback mapping parameters strictly: `(v: Vehicle)` and `(vehicle: Vehicle)`.

#### 3. [SalesAnalytics.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/dealer/SalesAnalytics.tsx)
* **Type Debt**:
  - No `@ts-nocheck`
  - `: any` at Line 36 (`(v: any)`) and Line 37 (`(v: any)`)
* **Compilation Failures**:
  - **0 errors**. (Compiles perfectly).
* **Technical Remediation Plan**:
  - Prune explicit `: any` from parameters on lines 36 & 37; type them as `Vehicle`: `(v: Vehicle)`.

---

### B. Mechanic Portal Pages

#### 4. [MechanicDashboard.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/mechanic/MechanicDashboard.tsx)
* **Type Debt**:
  - `@ts-nocheck` present at line 1
  - No `any[]` or `: any`
* **Compilation Failures (Without `// @ts-nocheck`)**:
  - `web/src/pages/dashboard/mechanic/MechanicDashboard.tsx(6,1): error TS6133: 'Progress' is declared but its value is never read.`
  - `web/src/pages/dashboard/mechanic/MechanicDashboard.tsx(10,26): error TS6133: 'Users' is declared but its value is never read.`
  - `web/src/pages/dashboard/mechanic/MechanicDashboard.tsx(11,3): error TS6133: 'AlertTriangle' is declared but its value is never read.`
  - `web/src/pages/dashboard/mechanic/MechanicDashboard.tsx(169,33): error TS2322: Type '"xs"' is not assignable to type '"default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg" | null | undefined'.`
* **Technical Remediation Plan**:
  - Remove `@ts-nocheck` directive.
  - Prune the unused imports (Progress, Users, AlertTriangle).
  - Correct custom button size `"xs"` $\rightarrow$ `"sm"` (Line 169) to align with standard Shadcn parameters.

#### 5. [CustomerRecords.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/mechanic/CustomerRecords.tsx)
* **Type Debt**:
  - `@ts-nocheck` present at line 1
  - No `any[]` or `: any`
* **Compilation Failures (Without `// @ts-nocheck`)**:
  - **0 errors**. (Compiles perfectly immediately!).
* **Technical Remediation Plan**:
  - Remove `@ts-nocheck` directive completely. No other type remediation is needed!

#### 6. [ServiceLogs.tsx](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/web/src/pages/dashboard/mechanic/ServiceLogs.tsx)
* **Type Debt**:
  - No `@ts-nocheck`
  - `any[]` at Line 20 (`useState<any[]>(mockLogs)`)
  - `: any` at Line 69 (`catch (err: any)`)
* **Compilation Failures**:
  - **0 errors**. (Compiles perfectly).
* **Technical Remediation Plan**:
  - Import `WorkOrder` from `@/types`.
  - Type `logs` state as `useState<WorkOrder[]>(mockLogs as WorkOrder[])`.
  - Narrow catch block exception at line 69 to `catch (err: unknown)`.

---

## 3. Recommended Remediation Order

We recommend a 4-Phase bottom-up execution sequence to ensure perfect stability with incremental compilation gates:

### Phase 1 — Zero Effort / Clean Compilation (No Risks)
1. **`CustomerRecords.tsx`**: Remove `@ts-nocheck` directive (0 compiler errors).
2. **`SalesAnalytics.tsx`**: Prune the 2 explicit `: any` parameters (0 compiler errors).
3. **`ServiceLogs.tsx`**: Type the logs state as `WorkOrder[]` and narrow the exception block (0 compiler errors).

### Phase 2 — Low Risk UI Polish
4. **`MechanicDashboard.tsx`**: Remove `@ts-nocheck`, prune unused imports, and correct the custom button size from `"xs"` to `"sm"`.

### Phase 3 — Medium Risk Permissions Indexing
5. **`DealerDashboard.tsx`**: Remove `@ts-nocheck`, type the branch inventory state as `Vehicle[]`, and declare `BranchPermissions` interface to resolve index signature errors.

### Phase 4 — High-Impact API Hook Boundary Resolution
6. **`Inventory.tsx`**: Remove `@ts-nocheck`, type `inventory` as `Vehicle[]`, and replace the destructured private `request()` utility call with a clean call to the public `updateVehicleStatus()` API hook method.

---

## 4. Conclusion

By executing this discovery audit, we have:
1. **Identified an architectural alignment**: Confirmed that `Inventory.tsx` has a clean path to full type safety by re-using `updateVehicleStatus` instead of requiring raw `request()` exposure.
2. **Discovered two immediate wins**: Validated that `CustomerRecords.tsx` has 0 compiler failures and can be type-remodeled instantly.
3. **Drafted a 4-Phase execution sequence** backed directly by real compiler-level diagnostic logs.
