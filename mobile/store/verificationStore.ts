import { create } from 'zustand';

export interface OcrResult {
  first_name?: string;
  last_name?: string;
  national_id_number?: string;
  date_of_birth?: string;
  country?: string;
  [key: string]: string | undefined;
}

export interface VerificationState {
  capturedFront: string | null;
  capturedBack: string | null;
  capturedSelfie: string | null;
  ocrResult: OcrResult | null;
  processingError: string | null;
  setCapturedFront: (uri: string) => void;
  setCapturedBack: (uri: string) => void;
  setCapturedSelfie: (uri: string) => void;
  setOcrResult: (result: OcrResult | null) => void;
  setProcessingError: (error: string | null) => void;
  hasRequiredImages: (doubleSided: boolean) => boolean;
  clear: () => void;
}

export const useVerificationStore = create<VerificationState>((set, get) => ({
  capturedFront: null,
  capturedBack: null,
  capturedSelfie: null,
  ocrResult: null,
  processingError: null,
  setCapturedFront: (uri) => set({ capturedFront: uri }),
  setCapturedBack: (uri) => set({ capturedBack: uri }),
  setCapturedSelfie: (uri) => set({ capturedSelfie: uri }),
  setOcrResult: (result) => set({ ocrResult: result }),
  setProcessingError: (error) => set({ processingError: error }),
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
  }),
}));
