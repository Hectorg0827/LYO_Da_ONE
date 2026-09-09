import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEST_PREP_OPENING_TURN,
  classroomEntryHref,
  reviewEntryHref,
  shouldShowLearnerDashboard,
  testPrepEntryHref,
} from './entry-contract.mjs';

const query = (href) => new URL(href, 'https://lyo.test').searchParams;

test('the front door opens the Classroom on what the learner typed', () => {
  const params = query(classroomEntryHref({ topic: 'AP Chemistry' }));
  assert.equal(params.get('topic'), 'AP Chemistry');
  // The Director always receives an intent, even when the learner gave none.
  assert.equal(params.get('objective'), 'Understand and apply AP Chemistry');
});

test('an empty topic is not a destination', () => {
  // The CTA stays disabled rather than pushing a Classroom with nothing to
  // teach.
  assert.equal(classroomEntryHref({ topic: '   ' }), null);
  assert.equal(classroomEntryHref({}), null);
});

test('surrounding whitespace never reaches the Classroom', () => {
  const params = query(classroomEntryHref({ topic: '  fractions \n' }));
  assert.equal(params.get('topic'), 'fractions');
  assert.equal(params.get('objective'), 'Understand and apply fractions');
});

test('a topic with a URL-significant character survives intact', () => {
  const params = query(classroomEntryHref({ topic: 'acids & bases: pH' }));
  assert.equal(params.get('topic'), 'acids & bases: pH');
});

test('no mode is pinned unless one was asked for', () => {
  // Absent a request, the Classroom's own default applies rather than this
  // module second-guessing it.
  assert.equal(query(classroomEntryHref({ topic: 'Fractions' })).get('mode'), null);
  assert.equal(
    query(classroomEntryHref({ topic: 'Fractions', mode: 'challenge' })).get('mode'),
    'challenge',
  );
});

test('an unrecognised mode fails safely to solo teaching', () => {
  const params = query(classroomEntryHref({ topic: 'Fractions', mode: 'party' }));
  assert.equal(params.get('mode'), 'solo');
});

test('course and lesson identity is carried through when present', () => {
  const params = query(
    classroomEntryHref({ topic: 'Fractions', courseId: 'course-7', lessonId: 'lesson-3' }),
  );
  assert.equal(params.get('courseId'), 'course-7');
  assert.equal(params.get('lessonId'), 'lesson-3');

  const bare = query(classroomEntryHref({ topic: 'Fractions' }));
  assert.equal(bare.get('courseId'), null);
  assert.equal(bare.get('lessonId'), null);
});

test('a due review enters review mode, carrying no stored question', () => {
  const href = reviewEntryHref('Quadratic Functions');
  const params = query(href);
  assert.equal(params.get('mode'), 'review');
  assert.equal(params.get('topic'), 'Quadratic Functions');
  assert.equal(params.get('objective'), 'Retrieve and re-apply Quadratic Functions');
  // Retrieval is generated fresh: replaying the exact question the learner
  // already saw tests recall of that question, not of the concept.
  assert.equal(params.get('question'), null);
  assert.equal(params.get('last_question'), null);
});

test('"I have a test" reaches the real test-prep intent by saying so', () => {
  // TEST_PREP is resolved by the backend router from what the learner says
  // (lyo_app/ai/router.py), so the entry opens Chat with that turn rather
  // than standing a client-side wizard in front of it.
  const href = testPrepEntryHref();
  assert.ok(href.startsWith('/chat?prompt='));
  assert.equal(query(href).get('prompt'), TEST_PREP_OPENING_TURN);
  // The router matches on "have a test"; losing that phrasing silently
  // downgrades the entry to a generic explanation.
  assert.match(TEST_PREP_OPENING_TURN, /have a test/i);
});

// ─── Front door vs learner dashboard ─────────────────────────────────────────

test('a signed-out visitor never sees the dashboard, even mid-hydration', () => {
  // The regression this guards: isLoading starts true, so treating "still
  // loading" as "known learner" rendered Level 1 / 0 XP / 0 courses to a
  // guest for as long as the auth request took — the zero dashboard the front
  // door exists to replace, just briefer.
  assert.equal(
    shouldShowLearnerDashboard({ authLoading: true, isAuthenticated: false, hasRealActivity: false }),
    false,
  );
  assert.equal(
    shouldShowLearnerDashboard({ authLoading: false, isAuthenticated: false, hasRealActivity: false }),
    false,
  );
});

test('the dashboard waits for auth even when activity is already known', () => {
  // Cached activity must not let the dashboard render before we know who is
  // looking at it.
  assert.equal(
    shouldShowLearnerDashboard({ authLoading: true, isAuthenticated: true, hasRealActivity: true }),
    false,
  );
});

test('a signed-in learner with real activity gets their dashboard', () => {
  assert.equal(
    shouldShowLearnerDashboard({ authLoading: false, isAuthenticated: true, hasRealActivity: true }),
    true,
  );
});

test('a signed-in learner with nothing yet still gets the front door', () => {
  // Signed in is not the same as having something to show. An account with no
  // activity is exactly who the front door is for.
  assert.equal(
    shouldShowLearnerDashboard({ authLoading: false, isAuthenticated: true, hasRealActivity: false }),
    false,
  );
});

test('missing state is treated as nothing known, not as a learner', () => {
  assert.equal(shouldShowLearnerDashboard({}), false);
  assert.equal(shouldShowLearnerDashboard(), false);
});
