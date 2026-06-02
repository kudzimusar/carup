# CarUp Kimi – Technical Testability Audit (Sprint Directive 001)

This comprehensive technical audit details the implementation of stable automated test selectors (`data-testid`), accessibility (`aria-label`) controls, known gaps, and future testing strategies across all stakeholder dashboards.

---

## 1. Metrics & Implementation Counts

| Metric | Count | Details |
| :--- | :--- | :--- |
| **Files Modified** | 13 | Covers authentication, layouts, and all stakeholder pages |
| **data-testid Added** | 69 | Static unique selector hooks (translates to 100+ dynamic DOM element targets) |
| **aria-label Added** | 16 | Descriptive labels for icon buttons and unlabelled input fields |
| **Dialogs Covered** | 4 | Add Part, Create Work Order, Registry Verification, Vehicle Reservation |
| **Forms Covered** | 5 | Login, Add Part, Create Work Order, Sell/List Vehicle, search forms |
| **Tables / Cards Covered** | 6 | Vehicles, Claims, Registry Verification, Parts, Work Orders, Service Logs |
| **Navigation Items Covered** | 7 | Overview, My Garage, Inventory, Claims, Work Orders, Registry, Sign Out |

---

## 2. Pages Audited & Selector Inventory

We performed a deep audit of the root pages, auth forms, layout shells, and role-specific dashboard directories:

### A. Authentication & Shell

* **Login View** (`web/src/pages/auth/Login.tsx`)
  * `email-input`: Email or Phone number field.
  * `password-input`: Password entry field.
  * `login-button`: Submit sign in.
  * Accessibility: Added visual label association, `aria-label` text, and `aria-label` to the password visibility icon button.
* **Side Navigation Dashboard Shell** (`web/src/components/layout/DashboardLayout.tsx`)
  * `nav-dashboard`: Sidebar Link to "Overview" dashboard.
  * `nav-garage`: Sidebar Link to "My Garage".
  * `nav-inventory`: Sidebar Link to dealer "Inventory".
  * `nav-claims`: Sidebar Link to insurance "Claims".
  * `nav-workorders`: Sidebar Link to mechanic "Work Orders".
  * `nav-registry`: Sidebar Link to government "Registry Verification".
  * `logout-button`: Sign out link inside sidebar footer.
* **Top Navigation Bar** (`web/src/components/layout/Navbar.tsx`)
  * `logout-button`: Standardized Sign Out actions in both profile dropdown menu and mobile slide-out nav links.

### B. Owner Portal (`web/src/pages/dashboard/owner`)

* **My Garage** (`MyGarage.tsx`)
  * `owner-vehicles-table`: Grid wrapper for owned vehicles.
  * `vehicle-row-${vehicle.id || vehicle.vin}`: Direct card link elements showing vehicle summary.
  * `create-vehicle-button`: Header button and empty-state button card to add a new vehicle listing.
* **PartSentry** (`PartSentry.tsx`)
  * `owner-parts-table`: Table element containing the blockchain parts tracking ledger.
  * `part-row-${part.id}`: Individual row records corresponding to tracked parts.
* **Service History** (`ServiceHistory.tsx`)
  * `workorders-search-input`: Search field for filter matching.
  * `workorders-table`: Service history card listing wrapper.
  * `workorder-row-${service.id}`: Card element corresponding to a service event.
* **Sell Vehicle Form** (`SellVehicle.tsx`)
  * `vehicle-make-input`: Make select dropdown trigger.
  * `vehicle-model-input`: Model input text box.
  * `vehicle-vin-input`: VIN input text box.
  * `submit-vehicle-button`: Submit button on final listing step.

### C. Dealer Portal (`web/src/pages/dashboard/dealer`)

* **Inventory Management** (`Inventory.tsx`)
  * `vehicle-search-input`: Search inventory filter field.
  * `dealer-vehicles-table`: Inventory listing card list wrapper.
  * `vehicle-row-${vehicle.id || vehicle.vin}`: Mapped vehicle card representing a single asset in inventory.
  * `create-vehicle-button`: Header and empty-state fallback listing links.
  * `empty-inventory-state`: Container shown when inventory is empty.

### D. Mechanic Portal (`web/src/pages/dashboard/mechanic`)

* **Parts Tracking** (`PartsTracking.tsx`)
  * `parts-search-input`: Search parts inventory field.
  * `mechanic-parts-table`: Table containing parts quantities, SKU numbers, and details.
  * `part-row-${part.id}`: Table rows representing individual parts stock.
  * `add-part-button`: Button triggering inventory add dialog.
  * `add-part-dialog`: Radix Content modal dialog block.
  * `part-name-input`: Form field inside Add Part dialog.
  * `part-sku-input`: SKU field inside Add Part dialog.
  * `stock-level-input`: Initial Stock quantity field inside Add Part dialog.
  * `unit-price-input`: Price field inside Add Part dialog.
  * `submit-part-button`: Form submission button.
  * `no-parts-state`: Block displayed when parts list matches no inventory results.
* **Work Orders Queue** (`WorkOrders.tsx`)
  * `workorders-search-input`: Filter search field.
  * `workorders-table`: Card queue of repair assignments.
  * `workorder-row-${order.id}`: Mapped work order details container.
  * `new-workorder-button`: Trigger button to log a repair job.
  * `create-workorder-dialog`: Creation dialog container wrapper.
  * `customer-name-input`: Form field inside creation dialog.
  * `vehicle-vin-input`: VIN field inside creation dialog.
  * `issue-description-input`: Problem description field.
  * `submit-workorder-button`: Form submit action.
  * `no-workorders-state`: OOS/empty state indicator.
* **Overview Workspace** (`MechanicDashboard.tsx`)
  * `mechanic-dashboard-create-workorder-button`: Action header to log order.
  * `create-workorder-dialog`: Dialog overlay container.
  * `vehicle-vin-input`, `customer-name-input`, `issue-description-input`, `submit-workorder-button`: Complete work order form targets.

### E. Insurance Portal (`web/src/pages/dashboard/insurance`)

* **Claims Processing** (`Claims.tsx`)
  * `claims-search-input`: Claims filter input.
  * `claims-table`: Grid layout of policy claims.
  * `claim-row-${claim.id}`: Mapped claim card element.
  * `approve-claim-button`: Action green check button.
  * `reject-claim-button`: Action red X button.
  * `no-claims-state`: Label shown when search filters match no claims.

### F. Government Portal (`web/src/pages/dashboard/government`)

* **Registry Verification** (`RegistryVerification.tsx`)
  * `registry-search-input`: VIN / Plate lookup search box.
  * `registry-table`: Table detailing pending applications.
  * `registry-row-${v.id}`: Verification row details element.
  * `open-registry-verification-button`: Eye icon click target opening details.
  * `registry-verification-dialog`: Portal dialog displaying history timeline and verification buttons.
  * `approve-registration-button`: Confirm registration button.
  * `reject-registration-button`: Decline registration button.

---

## 3. Accessibility Enhancements

A comprehensive audit was executed across all interactive elements. We verified that touch targets are accessible and added visual labels:
1. **Search Inputs**: Added explicit descriptive `aria-label` tags to all filter search inputs (e.g. `aria-label="Search by VIN, registration, or owner"`) to assist screen-reader users, as many search fields rely solely on visual placeholder layouts.
2. **Icon-Only Buttons**: Standardized `aria-label` attributes for controls displaying pure icons, notably:
   * View details eye icon buttons in `RegistryVerification.tsx` (`aria-label="View Verification Details"`).
   * Password visibility eye toggle buttons in `Login.tsx` (`aria-label="Show/Hide password"`).
   * Details eye buttons, Approve checkmarks, and Reject X marks in `Claims.tsx`.
3. **Radix Dialog Headers**: Validated that all dialog containers utilize Radix primitives (`DialogTitle`, `DialogDescription`) ensuring correct programmatic accessibility mappings inside portal windows.

---

## 4. Known Gaps & Untestable Components

1. **Third-Party Interactive Widgets**:
   * *Interactive Recharts*: The analytics charts on the `SalesAnalytics`, `MechanicDashboard`, and `CreditRiskAnalysis` utilize canvas and SVG elements rendered by `Recharts` that contain transient node targets. Automated Playwright assertions cannot query exact paths without visual screenshot regression.
   * *Leaflet Maps*: The `CollateralMap` under the Banker portal mounts an open-source Leaflet map. Markers and tiles are highly dynamic and lack simple class attributes.
2. **Immutable History Gaps**:
   * *No Edit/Delete Vehicle Buttons*: As designed in the trust-and-identity framework, vehicle records, mechanical repair logs, and odometer entries cannot be deleted or customized by end-users. Gaps in edit-vehicle/delete-vehicle buttons are deliberate system invariants to enforce cryptographic non-repudiation.

---

## 5. Future Playwright Verification Targets

The added selectors will serve as standard hooks for E2E user flows:

```javascript
// Example Playwright E2E Stakeholder Journey Verification
test('Mechanic creates work order and logs it to blockchain', async ({ page }) => {
  // 1. Navigate & Authenticate
  await page.goto('/login');
  await page.fill('[data-testid="email-input"]', 'simba@garage.co.zw');
  await page.fill('[data-testid="password-input"]', 'password123');
  await page.click('[data-testid="login-button"]');

  // 2. Go to Work Orders Portal
  await page.click('[data-testid="nav-workorders"]');
  await page.waitForSelector('[data-testid="workorders-table"]');

  // 3. Open Dialog Form & Submit
  await page.click('[data-testid="new-workorder-button"]');
  await page.fill('[data-testid="customer-name-input"]', 'Tendai Moyo');
  await page.fill('[data-testid="vehicle-vin-input"]', 'JTD123456789ABCDE');
  await page.fill('[data-testid="issue-description-input"]', 'Odometer calibration check & brake replacement');
  await page.click('[data-testid="submit-workorder-button"]');

  // 4. Validate Table Row exists
  const matchingRow = page.locator('[data-testid="workorders-table"] >> text=JTD123456789ABCDE');
  await expect(matchingRow).toBeVisible();
});
```
