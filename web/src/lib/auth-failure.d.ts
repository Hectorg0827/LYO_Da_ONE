export const RETURN_RETRY: 'return_retry';
export const REQUEST_FAILED: 'request_failed';
export const NOT_SIGNED_IN: 'not_signed_in';
export const SESSION_EXPIRED: 'session_expired';

export function classifyAuthFailure(outcome: {
  refreshed: boolean;
  retryStatus: number | null;
  optionalAuth?: boolean | undefined;
}): 'return_retry' | 'request_failed' | 'not_signed_in' | 'session_expired';
