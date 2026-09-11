import test from 'node:test';
import assert from 'node:assert/strict';

import { initialState, staleWarning, testPrepReducer } from './test-prep-state.mjs';

/** Apply a sequence of actions, as the page would. */
const run = (...actions) => actions.reduce(testPrepReducer, initialState);

const loaded = (planId = 'p1') =>
  run(
    { type: 'load_started' },
    { type: 'plan_loaded', planId },
    { type: 'details_loaded', readiness: { plan_id: planId }, sessions: [{ id: 's1' }, { id: 's2' }] },
    { type: 'load_settled' }
  );

// ─── A refresh never destroys what is on screen ──────────────────────────────

test('the first load blanks the page, a refresh does not', () => {
  const first = testPrepReducer(initialState, { type: 'load_started' });
  assert.equal(first.loading, true);

  const after = testPrepReducer(loaded(), { type: 'load_started' });
  assert.equal(after.loading, false, 'a refresh unmounted the plan view');
});

test('a refresh keeps the sessions already shown when the call fails', () => {
  const state = testPrepReducer(loaded(), { type: 'details_loaded', readiness: undefined });
  assert.equal(state.sessions.length, 2);
  assert.equal(state.sessionsFailed, true);
});

// ─── A failed request is never a fact about the learner ──────────────────────

test('a failed refresh does not send a learner who has a plan to intake', () => {
  // They would answer the intake questions again and come out with a second
  // plan, because one request happened to fail.
  const state = testPrepReducer(loaded(), { type: 'load_failed' });
  assert.equal(state.stage, 'plan');
  assert.equal(state.planId, 'p1');
  assert.equal(state.refreshFailed, true);
});

test('a failed first load sends them to intake and says so', () => {
  const state = run({ type: 'load_started' }, { type: 'load_failed' });
  assert.equal(state.stage, 'intake');
  assert.equal(state.planLoadFailed, true);
});

test('every failure has somewhere to be said', () => {
  // refreshFailed was set by the reducer and rendered nowhere for a whole
  // commit, which is how a failed refresh after finishing became silent.
  assert.ok(staleWarning(testPrepReducer(loaded(), { type: 'load_failed' })));
  assert.ok(staleWarning(testPrepReducer(loaded(), { type: 'details_loaded' })));
  assert.equal(staleWarning(loaded()), null);
  assert.equal(staleWarning(null), null);
});

test('a successful load with no plans is the only route to "no plan"', () => {
  const state = testPrepReducer(loaded(), { type: 'no_plan' });
  assert.equal(state.stage, 'intake');
  assert.equal(state.planId, null);
});

test('starting a load clears the previous failure notices', () => {
  const failed = testPrepReducer(loaded(), { type: 'load_failed' });
  const retry = testPrepReducer(failed, { type: 'load_started' });
  assert.equal(retry.refreshFailed, false);
  assert.equal(retry.planLoadFailed, false);
});

// ─── Finishing a session ─────────────────────────────────────────────────────

test('a finished session leaves the list immediately', () => {
  const state = testPrepReducer(loaded(), {
    type: 'finish_succeeded',
    sessionId: 's1',
    notice: 'Scored 75%.',
  });
  assert.deepEqual(state.sessions.map((s) => s.id), ['s2']);
  assert.equal(state.notice, 'Scored 75%.');
  assert.equal(state.finishing, null);
});

test('the summary survives a refresh that fails straight afterwards', () => {
  // The whole point of finishing is being told what the server measured. A
  // failed refresh must not take that away, and must not leave the row
  // looking open either.
  const done = testPrepReducer(loaded(), {
    type: 'finish_succeeded',
    sessionId: 's1',
    notice: 'Nothing was graded.',
  });
  const after = testPrepReducer(done, { type: 'load_failed' });
  assert.equal(after.notice, 'Nothing was graded.');
  assert.deepEqual(after.sessions.map((s) => s.id), ['s2']);
  assert.ok(staleWarning(after));
});

test('a later successful refresh replaces the list outright', () => {
  const done = testPrepReducer(loaded(), {
    type: 'finish_succeeded',
    sessionId: 's1',
    notice: 'Scored 75%.',
  });
  const after = testPrepReducer(done, { type: 'details_loaded', sessions: [{ id: 's2' }] });
  assert.deepEqual(after.sessions.map((s) => s.id), ['s2']);
  assert.equal(after.sessionsFailed, false);
});

test('starting a new finish clears the previous notice', () => {
  // Otherwise the score from the last session sits above a different one.
  const done = testPrepReducer(loaded(), {
    type: 'finish_succeeded',
    sessionId: 's1',
    notice: 'Scored 75%.',
  });
  const next = testPrepReducer(done, { type: 'finish_started', sessionId: 's2' });
  assert.equal(next.notice, null);
  assert.equal(next.finishing, 's2');
});

test('a failed finish says so and stops spinning', () => {
  const state = run(
    { type: 'load_started' },
    { type: 'plan_loaded', planId: 'p1' },
    { type: 'finish_started', sessionId: 's1' },
    { type: 'finish_failed', notice: 'I could not mark that done just now.' }
  );
  assert.equal(state.finishing, null);
  assert.match(state.notice, /could not mark/);
});

test('an unknown action changes nothing', () => {
  const state = loaded();
  assert.equal(testPrepReducer(state, { type: 'nonsense' }), state);
  assert.equal(testPrepReducer(state, undefined), state);
});

test('finishing a session that is not in the list is harmless', () => {
  const state = testPrepReducer(loaded(), {
    type: 'finish_succeeded',
    sessionId: 'gone',
    notice: 'Done.',
  });
  assert.equal(state.sessions.length, 2);
});
