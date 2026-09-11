/**
 * What to do when an authenticated request comes back 401.
 *
 * Extracted from `request()` because the branch has now been wrong three
 * times in a row, each fix introducing the next problem, and every attempt to
 * pin it was a source-text assertion in the CI gate. The logic is small and
 * entirely decidable from three facts, so it belongs somewhere it can simply
 * be tested.
 *
 * The distinction that kept getting lost: **"not authenticated" and "the
 * request failed" are different outcomes.** A refresh that succeeds proves the
 * learner is signed in; whatever the retried call then returns is a fact about
 * that call, not about their session. Treating it as a session expiry logs out
 * a signed-in learner over an unrelated server error.
 */

/** Give the caller its data. */
export const RETURN_RETRY = 'return_retry';
/** The retry failed for a non-auth reason; surface that status as-is. */
export const REQUEST_FAILED = 'request_failed';
/** No usable session, on a call that can live without one. */
export const NOT_SIGNED_IN = 'not_signed_in';
/** No usable session, on a call that needs one: clear tokens and send to login. */
export const SESSION_EXPIRED = 'session_expired';

/**
 * @param {object} outcome
 * @param {boolean} outcome.refreshed    did the token refresh succeed?
 * @param {number|null} outcome.retryStatus  status of the retried request, if one was made
 * @param {boolean} outcome.optionalAuth is this call supplementary?
 */
export function classifyAuthFailure({ refreshed, retryStatus, optionalAuth } = {}) {
  if (refreshed) {
    if (typeof retryStatus === 'number' && retryStatus >= 200 && retryStatus < 300) {
      return RETURN_RETRY;
    }
    // A fresh token still refused means the session really is no good.
    // Anything else is an ordinary failure of this particular request, and
    // reporting it as a logout would both mislead the caller and, on a
    // required call, throw the learner out over a server error.
    if (retryStatus !== 401) {
      return REQUEST_FAILED;
    }
  }

  return optionalAuth ? NOT_SIGNED_IN : SESSION_EXPIRED;
}
