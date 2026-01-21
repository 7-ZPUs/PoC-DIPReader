
export interface IntegrityCheckResult {
  isValid: boolean;
  calculatedHash: string;
  expectedHash: string;
}


export interface SavedIntegrityStatus extends IntegrityCheckResult {
  verifiedAt: string;
}


export type IntegrityStatus = 'none' | 'loading' | 'valid' | 'invalid' | 'error';
