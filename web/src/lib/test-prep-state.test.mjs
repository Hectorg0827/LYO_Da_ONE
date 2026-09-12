import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canStartIntake,
  initialState,
  readinessNote,
  sessionsNote,
  staleWarning,
  testPrepReducer,
  todayCopy,
} from './test-prep-state.mjs';

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
  // commit, which is how a failed refresh after finishing became silent. Each
  // failure now has exactly one place, which is why this checks a different
  // function per failure rather than one for both.
  assert.ok(staleWarning(testPrepReducer(loaded(), { type: 'load_failed' })));
  assert.ok(sessionsNote(testPrepReducer(loaded(), { type: 'details_loaded' })));
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

// ─── One failure, one sentence, in the right place ───────────────────────────

test('a page refresh failure does not overwrite a genuinely empty day', () => {
  // The sessions call succeeded and returned nothing; that is a fact about the
  // day. Only the overall refresh failed, which is a fact about the request.
  const empty = testPrepReducer(loaded(), { type: 'details_loaded', sessions: [] });
  const state = testPrepReducer(empty, { type: 'load_failed' });
  assert.ok(staleWarning(state), 'the page should say it could not refresh');
  assert.equal(sessionsNote(state), null, 'the day is empty, not unknown');
});

test('a failed sessions call is reported in the Today section', () => {
  const state = testPrepReducer(loaded(), { type: 'details_loaded' });
  assert.ok(sessionsNote(state));
});

test('two different failures never produce the same sentence twice', () => {
  const both = testPrepReducer(
    testPrepReducer(loaded(), { type: 'details_loaded' }),
    { type: 'load_failed' }
  );
  assert.ok(staleWarning(both));
  assert.ok(sessionsNote(both));
  assert.notEqual(staleWarning(both), sessionsNote(both));
});

test('all well means neither says anything', () => {
  assert.equal(staleWarning(loaded()), null);
  assert.equal(sessionsNote(loaded()), null);
  assert.equal(sessionsNote(null), null);
});

test('a failed sessions call does not claim the whole page is stale', () => {
  // Readiness, the plan and the countdown all loaded fine. Saying the page may
  // be out of date would overstate one failed call into a page-wide doubt.
  const state = testPrepReducer(loaded(), { type: 'details_loaded' });
  assert.equal(staleWarning(state), null);
  assert.ok(sessionsNote(state));
});

// ─── The Today section, in every combination ─────────────────────────────────

test('a sessions failure is reported whether or not rows remain', () => {
  // The failure used to be rendered only in the empty branch, so a refresh
  // that failed while keeping rows told the learner nothing.
  const failed = testPrepReducer(loaded(), { type: 'details_loaded' });
  assert.ok(todayCopy(failed, 2).note, 'silent while rows remain');
  assert.ok(todayCopy(failed, 0).note, 'silent on an empty list');
});

test('an empty list after a failed call is not reported as an empty day', () => {
  const failed = testPrepReducer(loaded(), { type: 'details_loaded' });
  assert.equal(todayCopy(failed, 0).emptyMessage, null);
});

test('a genuinely empty day says so', () => {
  const empty = testPrepReducer(loaded(), { type: 'details_loaded', sessions: [] });
  assert.equal(todayCopy(empty, 0).emptyMessage, 'Nothing scheduled for today.');
  assert.equal(todayCopy(empty, 0).note, null);
});

test('a working day with sessions says nothing extra', () => {
  const copy = todayCopy(loaded(), 2);
  assert.equal(copy.note, null);
  assert.equal(copy.emptyMessage, null);
});

// ─── A failed lookup must not become a second plan ───────────────────────────

test('intake is blocked while we do not know whether a plan exists', () => {
  // `load_failed` already refuses to send a learner who HAS a plan to intake.
  // This is the other half: on a first load we cannot tell, and intake ends in
  // `plans/generate`, which creates one unconditionally. Leaving the composer
  // live let a learner walk into a duplicate by hand — and on web the opening
  // turn is sent automatically, so they would not even have had to.
  const failed = run({ type: 'load_started' }, { type: 'load_failed' });
  assert.equal(failed.stage, 'intake');
  assert.equal(canStartIntake(failed), false, 'a duplicate plan is one keystroke away');
});

test('a retry that succeeds unblocks intake', () => {
  const failed = run({ type: 'load_started' }, { type: 'load_failed' });
  const retried = testPrepReducer(failed, { type: 'load_started' });
  assert.equal(canStartIntake(retried), true);

  const confirmed = testPrepReducer(retried, { type: 'no_plan' });
  assert.equal(canStartIntake(confirmed), true, 'a successful empty list is the green light');
});

test('a learner with no plan and no failure can start straight away', () => {
  const fresh = run({ type: 'load_started' }, { type: 'no_plan' }, { type: 'load_settled' });
  assert.equal(canStartIntake(fresh), true);
  assert.equal(canStartIntake(initialState), true);
  assert.equal(canStartIntake(null), true);
});

// ─── A stale readiness figure is not a current one ───────────────────────────

test('a failed readiness call keeps the figure but stops calling it current', () => {
  const state = testPrepReducer(loaded(), { type: 'details_loaded', sessions: [] });
  assert.ok(state.readiness, 'the last figure is kept rather than blanked');
  assert.ok(readinessNote(state), 'but it is no longer presented as up to date');
});

test('the readiness note is worst to omit right after finishing a session', () => {
  // The evidence has just changed. Showing the figure from before the work,
  // silently, claims it accounted for that work.
  const done = testPrepReducer(loaded(), {
    type: 'finish_succeeded',
    sessionId: 's1',
    notice: 'Scored 75%.',
  });
  const refreshFailed = testPrepReducer(done, { type: 'details_loaded', sessions: [] });
  assert.ok(readinessNote(refreshFailed));
  assert.equal(refreshFailed.notice, 'Scored 75%.', 'and the result still stands');
});

test('a successful readiness call clears the note', () => {
  const failed = testPrepReducer(loaded(), { type: 'details_loaded', sessions: [] });
  const ok = testPrepReducer(failed, {
    type: 'details_loaded',
    readiness: { plan_id: 'p1' },
    sessions: [],
  });
  assert.equal(readinessNote(ok), null);
});

test('a readiness failure does not claim the whole page is stale', () => {
  const state = testPrepReducer(loaded(), { type: 'details_loaded', sessions: [] });
  assert.equal(staleWarning(state), null);
  assert.ok(readinessNote(state));
  assert.equal(readinessNote(loaded()), null);
  assert.equal(readinessNote(null), null);
});

test('three different failures never produce the same sentence', () => {
  const all = testPrepReducer(
    testPrepReducer(loaded(), { type: 'details_loaded' }),
    { type: 'load_failed' }
  );
  const sentences = [staleWarning(all), sessionsNote(all), readinessNote(all)];
  assert.equal(new Set(sentences).size, 3, sentences.join(' | '));
});
