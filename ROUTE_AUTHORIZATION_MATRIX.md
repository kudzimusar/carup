# CarUp OS — Route Authorization Matrix (Directive 009A)

This matrix maps all backend API routes, their HTTP verbs, their active authentication middleware, their required stakeholder roles, and their risk classifications.

---

## 1. Route Authorization Matrix Table

| Endpoint Route | Method | Active Middleware | Target/Actor Role | Risk Classification |
| :--- | :---: | :--- | :--- | :--- |
| `/api/auth/login` | `POST` | *None (Public)* | Guest | **Safe** |
| `/api/auth/register` | `POST` | *None (Public)* | Guest | **Safe** |
| `/api/auth/switch-role` | `POST` | *None (Public)* | Guest / User | **Critical Risk** (No auth check) |
| `/api/health` | `GET` | *None (Public)* | Guest | **Safe** |
| `/api/vehicles/:vin/details` | `GET` | *None (Public)* | Guest / User | **Safe** |
| `/api/vehicles` | `GET` | *None (Public)* | Guest / User | **Safe** |
| `/api/vehicles/:vin/passport` | `GET` | *None (Public)* | Guest / User | **Safe** |
| `/api/vehicles/:vin/verify-ledger`| `GET` | *None (Public)* | Guest / User | **Safe** (Read-only blockchain check) |
| `/api/vehicles/:vin/odometer-audit`| `GET` | *None (Public)* | Guest / User | **Safe** (Read-only forensics check) |
| `/api/vehicles/:vin/status` | `PATCH`| *None (Public)* | Guest / User | **Critical Risk** (Lack of auth/role) |
| `/api/vehicles/add` | `POST` | `authorizeRole([...])` | `dealer`, `owner`, `admin` | **Needs Role Check** |
| `/api/vehicles/inventory` | `GET` | `authorizeRole([...])` | `dealer`, `admin` | **Needs Role Check** |
| `/api/safepay/create` | `POST` | `authorizeRole()` | Authenticated User | **Needs Auth** |
| `/api/safepay/list` | `GET` | `authorizeRole()` | Authenticated User | **Needs Auth / Scope filter** |
| `/api/safepay/:id/update` | `POST` | `authorizeRole()` | Authenticated User | **Needs Auth / Stage Guard** |
| `/api/safepay/webhook` | `POST` | *None (Public)* | Webhook Provider | **Dangerous** (Missing signature validation) |
| `/api/partsentry/add` | `POST` | `authorizeRole([...])` | `mechanic` | **Needs Role Check** |
| `/api/partsentry/:vin` | `GET` | *None (Public)* | Guest / User | **Safe** (Read-only history logs) |
| `/api/ai/ocr` | `POST` | *None (Public)* | Guest / User | **High Risk** (Unprotected AI execution) |
| `/api/ai/fraud-scan` | `POST` | *None (Public)* | Guest / User | **High Risk** (Unprotected AI execution) |
| `/api/ai/risk-assessment` | `POST` | *None (Public)* | Guest / User | **High Risk** (Unprotected AI execution) |
| `/api/finance/pre-approve` | `POST` | `authorizeRole()` | Authenticated User | **Needs Auth** |
| `/api/finance/applications` | `GET` | `authorizeRole([...])` | `admin`, `finance`, `bank` | **Needs Role Check** |
| `/api/finance/applications/:id/update` | `POST` | `authorizeRole([...])` | `admin`, `finance`, `bank` | **Needs Role Check** (Batch 1 audited) |
| `/api/insurance/quote` | `POST` | *None (Public)* | Guest / User | **Safe** (Computational policy quote) |
| `/api/insurance/claims` | `GET` | `authorizeRole([...])` | `insurance`, `admin` | **Needs Role Check** |
| `/api/insurance/claims/:id/status` | `PATCH`| `authorizeRole([...])` | `insurance`, `admin` | **Needs Role Check** |
| `/api/import/duty-estimate` | `POST` | *None (Public)* | Guest / User | **Safe** (Mathematical estimation) |
| `/api/security/report-stolen` | `POST` | `authorizeRole([...])` | `owner`, `government` | **Needs Role Check** |
| `/api/security/check-stolen/:vin` | `GET` | *None (Public)* | Guest / User | **Safe** |
| `/api/reputation/:dealerId` | `GET` | *None (Public)* | Guest / User | **Safe** |
| `/api/vehicles/:vin/recommendations`| `GET` | *None (Public)* | Guest / User | **Safe** |
| `/api/vehicles/:vin/reserve` | `POST` | *None (Public)* | Guest / User | **Medium Risk** (Unprotected reservation write) |
| `/api/organizations/my-org` | `GET` | `authorizeRole()` | Authenticated User | **Needs Auth** |
| `/api/organizations/:id/branches` | `GET` | *None (Public)* | Guest / User | **Medium Risk** (Public branch fetch) |
| `/api/organizations/:id/users` | `GET` | *None (Public)* | Guest / User | **Medium Risk** (Public B2B user directory) |
| `/api/organizations/:id/audit-logs`| `GET` | *None (Public)* | Guest / User | **Critical Risk** (Public B2B log read) |
| `/api/organizations/:id/audit-logs`| `POST` | *None (Public)* | Guest / User | **Critical Risk** (Public direct log injection) |
| `/api/compliance/registry` | `GET` | `authorizeRole([...])` | `government`, `admin` | **Needs Role Check** |
| `/api/compliance/registry/:id/update`| `POST` | `authorizeRole([...])` | `government`, `admin` | **Needs Role Check** (Batch 1 audited) |
| `/api/users/management` | `GET` | `authorizeRole([...])` | `admin` | **Needs Role Check** |
| `/api/admin/stats` | `GET` | `authorizeRole([...])` | `admin` | **Needs Role Check** |
| `/api/admin/health` | `GET` | `authorizeRole([...])` | `admin` | **Needs Role Check** |
| `/api/admin/users` | `GET` | `authorizeRole([...])` | `admin` | **Needs Role Check** |
| `/api/admin/users/:id/suspend` | `PATCH`| `authorizeRole([...])` | `admin` | **Needs Role Check** |
| `/api/telemetry` | `GET` | `authorizeRole([...])` | `bank`, `insurance`, `government`, `admin` | **Needs Role Check** |

---

## 2. Severity Classification Summary

1. **Critical Risk (Unprotected Mutating & Privileged Routes)**:
   * `PATCH /api/vehicles/:vin/status`: Lacks any auth guards. Anyone can quarantine or restore any vehicle.
   * `POST /api/auth/switch-role`: Lacks session verification. Anyone can hijack any user context by ID.
   * `GET /api/organizations/:id/audit-logs`: Lacks auth. Anyone can read sensitive organizational changes.
   * `POST /api/organizations/:id/audit-logs`: Lacks auth. Anyone can spoof organizational audits.
2. **High Risk (Unprotected Computational/Storage Routes)**:
   * `POST /api/ai/ocr`, `POST /api/ai/fraud-scan`, `POST /api/ai/risk-assessment`: Lacks auth. Exposed to high billing depletion attacks.
3. **Medium Risk (Unprotected Safe Operations)**:
   * `POST /api/vehicles/:vin/reserve`: Public vehicle reservation without active user session validation.
   * `GET /api/organizations/:id/users`, `GET /api/organizations/:id/branches`: Exposed internal operational structure.
4. **Safe / Needs Auth (Appropriately Protected)**:
   * Routes utilizing standard `authorizeRole()` or computational endpoints with no database side effects.

---
**Matrix compiled by Antigravity AI.**  
*Status: 4 Critical Gaps Mapped. Backend fortification required.*
