import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOT_SIGNED_IN,
  REQUEST_FAILED,
  RETURN_RETRY,
  SESSION_EXPIRED,
  classifyAuthFailure,
} from './auth-failure.mjs';

// ─── The distinction that kept getting lost ──────────────────────────────────

test('a refreshed token that then works returns the data', () => {
  assert.equal(
    classifyAuthFailure({ refreshed: true, retryStatus: 200 }),
    RETURN_RETRY
  );
  assert.equal(
    classifyAuthFailure({ refreshed: true, retryStatus: 204 }),
    RETURN_RETRY
  );
});

test('a server error after a good refresh is not a logout', () => {
  // The refresh succeeded, so the learner *is* signed in. Reporting a 500 as
  // a session expiry would throw them out over an unrelated backend fault.
  assert.equal(
    classifyAuthFailure({ refreshed: true, retryStatus: 500 }),
    REQUEST_FAILED
  );
  assert.equal(
    classifyAuthFailure({ refreshed: true, retryStatus: 404 }),
    REQUEST_FAILED
  );
});

test('a server error is not a logout for optional calls either', () => {
  // Reporting it as "not signed in" discards the real status from a caller
  // that might have handled it.
  assert.equal(
    classifyAuthFailure({ refreshed: true, retryStatus: 503, optionalAuth: true }),
    REQUEST_FAILED
  );
});

test('a fresh token that is still refused really is a dead session', () => {
  assert.equal(
    classifyAuthFailure({ refreshed: true, retryStatus: 401 }),
    SESSION_EXPIRED
  );
  assert.equal(
    classifyAuthFailure({ refreshed: true, retryStatus: 401, optionalAuth: true }),
    NOT_SIGNED_IN
  );
});

// ─── No session at all ───────────────────────────────────────────────────────

test('a required call with no usable session goes to login', () => {
  assert.equal(
    classifyAuthFailure({ refreshed: false, retryStatus: null }),
    SESSION_EXPIRED
  );
});

test('a supplementary call with no usable session simply has no data', () => {
  // This is what keeps a guest on the front door instead of at /auth/login.
  assert.equal(
    classifyAuthFailure({ refreshed: false, retryStatus: null, optionalAuth: true }),
    NOT_SIGNED_IN
  );
});

test('an optional call never reaches the redirect', () => {
  for (const retryStatus of [null, 401, 500, 200]) {
    for (const refreshed of [true, false]) {
      assert.notEqual(
        classifyAuthFailure({ refreshed, retryStatus, optionalAuth: true }),
        SESSION_EXPIRED,
        `optional call classified as a logout for ${refreshed}/${retryStatus}`
      );
    }
  }
});

// ─── Shapes it should survive ────────────────────────────────────────────────

test('a missing outcome is treated as no session, not as success', () => {
  assert.equal(classifyAuthFailure(), SESSION_EXPIRED);
  assert.equal(classifyAuthFailure({}), SESSION_EXPIRED);
});

test('a non-numeric retry status is never read as success', () => {
  for (const retryStatus of [undefined, null, '200', NaN]) {
    assert.notEqual(
      classifyAuthFailure({ refreshed: true, retryStatus }),
      RETURN_RETRY
    );
  }
});
