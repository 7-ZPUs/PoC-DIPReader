
export interface IntegrityCheckResult {
  isValid: boolean;
  calculatedHash: string;
  expectedHash: string;
}


export interface SavedIntegrityStatus {
  verifiedAt: string;
  algorithm: string;
  result: boolean;
}


export type IntegrityStatus = 'none' | 'loading' | 'valid' | 'invalid' | 'error';
