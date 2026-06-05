import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * CarUp OS — Async Context Store for Request/Execution Scope
 * Used to share Correlation ID and Tenant ID across async operations without parameter drilling.
 */
export const asyncStore = new AsyncLocalStorage();
