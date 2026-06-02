# Backend Centralized Error Handling Foundation Report

This report documents the successful implementation of the backend error handling framework under **Directive 006B**, establishing standard custom error classes, a safe 404 route fallback handler, and a centralized Express error middleware matching our production-ready structural schema.

---

## 1. Files Modified & Created

* **[NEW] [backend/utils/errors.js](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/backend/utils/errors.js)**: Holds the domain-specific custom error sub-classes derived from the base `CarUpError` class.
* **[NEW] [backend/middleware/errorMiddleware.js](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/backend/middleware/errorMiddleware.js)**: Implements the global centralized Express error-handling middleware (`errorHandler`) formatting all payloads matching the standard JSON error schema.
* **[MODIFY] [backend/server.js](file:///Users/shadreckmusarurwa/Project%20AI/carup-kimi/backend/server.js)**:
  - Imported `errorHandler` and `NotFoundError` using standard ES Module syntax at the top of the file.
  - Registered a safe 404 route fallback handler at the bottom, just after all routes and before `app.listen`.
  - Registered the centralized `errorHandler` middleware right after the 404 handler, capturing all upstream runtime failures.

---

## 2. Custom Error Classes Defined

All classes reside in `backend/utils/errors.js` and extend the base `CarUpError` class (which inherits from the native Javascript `Error`). Every class maps to a default HTTP status code and a distinct system code:

1. **`CarUpError`**: Base class implementing explicit stack trace capturing, HTTP status code (`statusCode`), system code (`code`), and optional developer-facing metadata (`details`).
2. **`ValidationError`**: Maps to `400` status and `VALIDATION_FAILED` code. Used for invalid input payloads, schemas, or query formats.
3. **`UnauthorizedError`**: Maps to `401` status and `UNAUTHORIZED_ACCESS` code. Used for missing or expired sessions.
4. **`ForbiddenError`**: Maps to `403` status and `INSUFFICIENT_PERMISSIONS` code. Used for role authorization mismatches.
5. **`NotFoundError`**: Maps to `404` status and `RESOURCE_NOT_FOUND` code. Used for missing registry resources or unmatched routes.
6. **`DatabaseError`**: Maps to `500` status and `DATABASE_ERROR` code. Used to wrap internal Supabase transactional failures securely.

---

## 3. Global Middleware Behavior

The `errorHandler` middleware in `backend/middleware/errorMiddleware.js` handles unhandled and structured failures using these core operations:

* **Standard Output Format**: Formats and returns the exact requested JSON error schema payload:
  ```json
  {
    "success": false,
    "error": {
      "code": "ERROR_CODE",
      "message": "User-friendly message",
      "details": "Only outside production viewports",
      "timestamp": "ISO-8601-String",
      "requestId": "req-uuid"
    }
  }
  ```
* **Unique Request Tracing**: Automatically generates a unique, request-specific tracing UUID prefix `req-` (using modern Node.js native `crypto.randomUUID()`) for each error event to simplify production log auditing.
* **Internal Log Output**: Logs the full error stack, path, HTTP method, status, and request ID to `console.error` for backend developer auditing.
* **Security Filter**: If `process.env.NODE_ENV === 'production'`, the middleware automatically intercepts and strips the `error.details` property, completely preventing database schema descriptions or environment details from leaking to external client viewports.

---

## 4. 404 Route Fallback Behavior

A safe catch-all wildcard handler has been mounted at the very bottom of the Express routing registry, catching all unhandled client route queries:
```javascript
app.use((req, res, next) => {
  next(new NotFoundError('Route not found'));
});
```
When a client requests a non-existent endpoint (e.g. `/api/v1/invalid-route`), the fallback handler generates a new strongly-typed `NotFoundError` and triggers the Express lifecycle `next(err)`. This routes the failure into our central `errorHandler`, which cleanly outputs a standardized 404 JSON error response instead of letting the gateway hang or crash.

---

## 5. Validation & Verification Metrics

### Backend Test Results
- **Command**: `npm test` inside the `/backend` folder.
- **Results**: **24 out of 24 tests passed** cleanly with exit code 0, confirming that registering our new centralized error handling foundation does not break any existing database queries, blockchain cryptographic integrations, AI Multi-Agent structures, or RBAC gateway guardrails.

### Monorepo Build Results
- **Build Verification**: `npm run build` executed from the repository root successfully compiled the entire monorepo in **23.20s** with 0 bundle or bundle parsing failures.
- **Type safety compiler verification**: `npx tsc --noEmit --project web/tsconfig.app.json` completed with **0 type compilation errors**, confirming absolute monorepo type-checking safety.

### Route-Level Manual res.status(500) Count
- **Remaining Count**: **81 manual occurrences** in `backend`.
- *Note*: As instructed in Directive 006B, this phase only creates the shared foundation. None of the existing routes have been refactored yet, meaning they continue to return their manual `res.status(500)` blocks, keeping existing features isolated and intact.
