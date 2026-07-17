import { create } from 'zustand';

export interface OcrResult {
  first_name?: string;
  last_name?: string;
  national_id_number?: string;
  date_of_birth?: string;
  country?: string;
  additional_fields?: Record<string, string>;
  [key: string]: string | Record<string, string> | undefined;
}

export type VerificationOutcomeStatus =
  | 'idle'
  | 'verified'
  | 'backend_pending'
  | 'ocr_failed'
  | 'needs_review'
  | 'retry_requested'
  | 'incomplete'
  | 'rejected';

export interface VerificationState {
  capturedFront: string | null;
  capturedBack: string | null;
  capturedSelfie: string | null;
  ocrResult: OcrResult | null;
  processingError: string | null;
  verificationStatus: VerificationOutcomeStatus;
  verificationSessionId: string | null;
  /** Raw backend session status, used with the shared status map for copy. */
  verificationSessionStatus: string | null;
  /** True while a manual status refresh request is in flight. */
  isRefreshing: boolean;
  setCapturedFront: (uri: string | null) => void;
  setCapturedBack: (uri: string | null) => void;
  setCapturedSelfie: (uri: string | null) => void;
  setOcrResult: (result: OcrResult | null) => void;
  setProcessingError: (error: string | null) => void;
  setVerificationOutcome: (
    status: VerificationOutcomeStatus,
    sessionId?: string | null,
    error?: string | null,
    sessionStatus?: string | null,
  ) => void;
  setRefreshing: (refreshing: boolean) => void;
  hasRequiredImages: (doubleSided: boolean) => boolean;
  clear: () => void;
}

export const useVerificationStore = create<VerificationState>((set, get) => ({
  capturedFront: null,
  capturedBack: null,
  capturedSelfie: null,
  ocrResult: null,
  processingError: null,
  verificationStatus: 'idle',
  verificationSessionId: null,
  verificationSessionStatus: null,
  isRefreshing: false,
  setCapturedFront: (uri) => set({ capturedFront: uri }),
  setCapturedBack: (uri) => set({ capturedBack: uri }),
  setCapturedSelfie: (uri) => set({ capturedSelfie: uri }),
  setOcrResult: (result) => set({ ocrResult: result }),
  setProcessingError: (error) => set({ processingError: error }),
  setVerificationOutcome: (status, sessionId = null, error = null, sessionStatus = null) => set({
    verificationStatus: status,
    verificationSessionId: sessionId,
    processingError: error,
    verificationSessionStatus: sessionStatus,
  }),
  setRefreshing: (refreshing) => set({ isRefreshing: refreshing }),
  hasRequiredImages: (doubleSided) => {
    const state = get();
    if (!state.capturedFront) return false;
    if (doubleSided && !state.capturedBack) return false;
    if (!state.capturedSelfie) return false;
    return true;
  },
  clear: () => set({
    capturedFront: null,
    capturedBack: null,
    capturedSelfie: null,
    ocrResult: null,
    processingError: null,
    verificationStatus: 'idle',
    verificationSessionId: null,
    verificationSessionStatus: null,
    isRefreshing: false,
  }),
}));
