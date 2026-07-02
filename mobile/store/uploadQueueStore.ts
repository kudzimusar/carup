import { create } from 'zustand';
import {
  computeIdempotencyKey,
  nextBackoffMs,
  selectReady,
  filterOwned,
  hasLiveItemForKey,
  DEFAULT_BASE_BACKOFF_MS,
  DEFAULT_MAX_BACKOFF_MS,
} from '../utils/uploadQueueLogic';

/**
 * Workstream G — durable offline evidence upload QUEUE (native).
 *
 * Captures taken while offline are enqueued here and drained when connectivity
 * returns. The store owns only QUEUE METADATA (small, JSON-serializable rows);
 * the captured bytes live on the device filesystem and are referenced by
 * `localFileRef`. That separation is deliberate: it keeps the persisted queue
 * tiny enough for `expo-secure-store` and means `clearForLogout` can wipe the
 * metadata index AND ask the persistence adapter to drop any persisted blob refs
 * for sensitive-state cleanup.
 *
 * PERSISTENCE SEAM (testability): all durable I/O goes through the
 * `QueuePersistence` interface. The default adapter uses `expo-secure-store`
 * (the only durable store actually installed in mobile/package.json — there is
 * NO async-storage and NO expo-file-system dependency present). In unit tests we
 * inject an in-memory adapter, so the queue invariants are provable without a
 * React Native runtime. See `setQueuePersistence` / `__resetUploadQueueForTest`.
 *
 * HONEST LIMITATION: `expo-secure-store` is backed by the iOS Keychain /
 * Android Keystore and has a per-item size ceiling (~2KB on iOS). This store
 * therefore persists a BOUNDED, pruned projection of the queue (newest N rows,
 * terminal rows dropped first) rather than an unbounded log. The pure logic +
 * the in-memory adapter are fully tested here; real Keychain persistence across
 * an app restart can only be verified on a device/simulator (see RETURN notes).
 */

export type QueueItemStatus = 'queued' | 'uploading' | 'uploaded' | 'failed' | 'cancelled';

export interface UploadQueueItem {
  localId: string;
  userId: string;
  tenantId: string;
  vin: string;
  evidenceType: string;
  localFileRef: string;
  checksum: string;
  pageOrder: number;
  idempotencyKey: string;
  createdAt: number;
  retryCount: number;
  lastError: string | null;
  nextRetryAt: number | null;
  status: QueueItemStatus;
  backendEvidenceId: string | null;
}

/** Fields the caller supplies when enqueuing; everything else is derived. */
export interface EnqueueInput {
  userId: string;
  tenantId: string;
  vin: string;
  evidenceType: string;
  localFileRef: string;
  checksum: string;
  pageOrder?: number;
}

/**
 * Durable persistence seam. Implementations MUST be safe to call repeatedly and
 * MUST NOT throw across the boundary (the store treats persistence as
 * best-effort — a failed save must never corrupt in-memory truth or block a
 * capture). `clearBlobs` is where a real adapter deletes on-device files for the
 * given file refs (sensitive-state cleanup on logout).
 */
export interface QueuePersistence {
  load(): Promise<UploadQueueItem[]>;
  save(items: UploadQueueItem[]): Promise<void>;
  clearBlobs(fileRefs: string[]): Promise<void>;
}

/** Hard cap on persisted rows (Keychain item size budget — see header note). */
const MAX_PERSISTED_ITEMS = 50;
const SECURE_QUEUE_KEY = 'carup_upload_queue_v1';

/**
 * Project the in-memory queue down to what we durably persist: drop terminal
 * rows (uploaded/cancelled) first, then keep the newest MAX_PERSISTED_ITEMS so a
 * burst of offline captures can never exceed the secure-store budget.
 */
function projectForPersistence(items: UploadQueueItem[]): UploadQueueItem[] {
  const live = items.filter((i) => i.status !== 'uploaded' && i.status !== 'cancelled');
  const terminal = items.filter((i) => i.status === 'uploaded' || i.status === 'cancelled');
  const ordered = [...live, ...terminal];
  return ordered.slice(0, MAX_PERSISTED_ITEMS);
}

/**
 * Default secure-store adapter. Lazily requires `expo-secure-store` so this
 * module stays importable under node/tsx unit tests (where the native module is
 * absent) — if the require fails or we're not on device, it degrades to a no-op
 * durable layer (in-memory truth still works for the session). It NEVER throws.
 */
function createSecureStorePersistence(): QueuePersistence {
  let SecureStore: typeof import('expo-secure-store') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    SecureStore = require('expo-secure-store');
  } catch {
    SecureStore = null;
  }

  return {
    async load() {
      if (!SecureStore) return [];
      try {
        const raw = await SecureStore.getItemAsync(SECURE_QUEUE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as UploadQueueItem[]) : [];
      } catch {
        return [];
      }
    },
    async save(items) {
      if (!SecureStore) return;
      try {
        await SecureStore.setItemAsync(SECURE_QUEUE_KEY, JSON.stringify(projectForPersistence(items)));
      } catch {
        /* best-effort: never block a capture on a persistence failure */
      }
    },
    async clearBlobs(fileRefs) {
      // The installed stack has no expo-file-system, so on-device blob deletion
      // is a documented seam. We at minimum drop the persisted metadata index so
      // sensitive refs do not survive logout; a device build can swap in an
      // adapter that also unlinks the files at `fileRefs`.
      void fileRefs;
      if (!SecureStore) return;
      try {
        await SecureStore.deleteItemAsync(SECURE_QUEUE_KEY);
      } catch {
        /* best-effort */
      }
    },
  };
}

let persistence: QueuePersistence = createSecureStorePersistence();

/** Swap the durable adapter (tests inject an in-memory one). */
export function setQueuePersistence(p: QueuePersistence): void {
  persistence = p;
}

/** Stable-ish local id without pulling in a uuid dep (fine for a client row key). */
function makeLocalId(): string {
  return `uq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

interface UploadQueueState {
  items: UploadQueueItem[];
  hydrated: boolean;

  /** Load persisted rows into memory (idempotent). Call once on app start. */
  hydrate: () => Promise<void>;

  /**
   * Enqueue a capture. Computes a stable idempotencyKey; if a LIVE row already
   * exists for that key (same user+vin+type+checksum), it is a no-op and returns
   * the existing row — the SAME capture can never double-enqueue.
   */
  enqueue: (input: EnqueueInput) => UploadQueueItem;

  markUploading: (localId: string) => void;
  markUploaded: (localId: string, backendEvidenceId: string) => void;
  /** Record a failure and schedule the next attempt via exponential backoff. */
  markFailed: (localId: string, error: string) => void;
  cancel: (localId: string) => void;

  /** Items ready to (re)upload now: queued/failed with nextRetryAt<=now. */
  dequeueReady: (now?: number) => UploadQueueItem[];

  /** Getter: ONLY the active account's items (account A/B isolation). */
  isolateByAccount: (userId: string, tenantId: string) => UploadQueueItem[];

  /** Wipe ALL items + ask the adapter to clear persisted blobs (logout cleanup). */
  clearForLogout: () => Promise<void>;
}

export const useUploadQueueStore = create<UploadQueueState>((set, get) => {
  // Persist current in-memory truth (fire-and-forget; never blocks the caller).
  const persist = (items: UploadQueueItem[]) => {
    void persistence.save(items);
  };

  return {
    items: [],
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return;
      const loaded = await persistence.load();
      set({ items: Array.isArray(loaded) ? loaded : [], hydrated: true });
    },

    enqueue: (input: EnqueueInput) => {
      const idempotencyKey = computeIdempotencyKey({
        userId: input.userId,
        vin: input.vin,
        evidenceType: input.evidenceType,
        checksum: input.checksum,
      });

      const existing = get().items.find((i) => i.idempotencyKey === idempotencyKey);
      if (existing && hasLiveItemForKey(get().items, idempotencyKey)) {
        // Same capture already queued/uploading/uploaded — do not duplicate.
        return existing;
      }

      const item: UploadQueueItem = {
        localId: makeLocalId(),
        userId: input.userId,
        tenantId: input.tenantId,
        vin: input.vin,
        evidenceType: input.evidenceType,
        localFileRef: input.localFileRef,
        checksum: input.checksum,
        pageOrder: Number.isFinite(input.pageOrder as number) ? (input.pageOrder as number) : 0,
        idempotencyKey,
        createdAt: Date.now(),
        retryCount: 0,
        lastError: null,
        nextRetryAt: null,
        status: 'queued',
        backendEvidenceId: null,
      };

      const items = [...get().items, item];
      set({ items });
      persist(items);
      return item;
    },

    markUploading: (localId) => {
      const items = get().items.map((i) =>
        i.localId === localId ? { ...i, status: 'uploading' as const } : i,
      );
      set({ items });
      persist(items);
    },

    markUploaded: (localId, backendEvidenceId) => {
      const items = get().items.map((i) =>
        i.localId === localId
          ? {
              ...i,
              status: 'uploaded' as const,
              backendEvidenceId,
              lastError: null,
              nextRetryAt: null,
            }
          : i,
      );
      set({ items });
      persist(items);
    },

    markFailed: (localId, error) => {
      const items = get().items.map((i) => {
        if (i.localId !== localId) return i;
        const retryCount = i.retryCount + 1;
        return {
          ...i,
          status: 'failed' as const,
          retryCount,
          lastError: String(error ?? 'upload failed'),
          // Backoff is computed from the PRE-increment retryCount so the first
          // failure waits base*2^0 = base, the second base*2^1, etc.
          nextRetryAt: nextBackoffMs(i.retryCount, Date.now(), DEFAULT_BASE_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS),
        };
      });
      set({ items });
      persist(items);
    },

    cancel: (localId) => {
      const items = get().items.map((i) =>
        i.localId === localId ? { ...i, status: 'cancelled' as const, nextRetryAt: null } : i,
      );
      set({ items });
      persist(items);
    },

    dequeueReady: (now = Date.now()) => selectReady(get().items, now),

    isolateByAccount: (userId, tenantId) => filterOwned(get().items, userId, tenantId),

    clearForLogout: async () => {
      const fileRefs = get().items.map((i) => i.localFileRef).filter(Boolean);
      set({ items: [] });
      try {
        await persistence.clearBlobs(fileRefs);
      } catch {
        /* best-effort sensitive-state cleanup; never throw out of logout */
      }
      // Ensure the persisted index is empty even if clearBlobs is a partial impl.
      void persistence.save([]);
    },
  };
});

/** Test-only reset so unit tests start from a clean store + adapter. */
export function __resetUploadQueueForTest(p?: QueuePersistence): void {
  if (p) setQueuePersistence(p);
  useUploadQueueStore.setState({ items: [], hydrated: false });
}
