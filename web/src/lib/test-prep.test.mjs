import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STAGE_INTAKE,
  STAGE_PLAN,
  currentPlan,
  daysLabel,
  intakeIsComplete,
  openSessions,
  readinessHeadline,
  sessionEntryHref,
  stageForPlans,
  topicStanding,
} from './test-prep.mjs';

// ─── No plan is the normal first state ───────────────────────────────────────

test('a learner with no plan is asked about their test', () => {
  // Every learner is in this state today: nothing on any client could create
  // a plan. Landing them on an empty readiness card would be the zero
  // dashboard all over again.
  assert.equal(stageForPlans([]), STAGE_INTAKE);
  assert.equal(stageForPlans(null), STAGE_INTAKE);
  assert.equal(stageForPlans(undefined), STAGE_INTAKE);
});

test('a learner with a plan is shown it', () => {
  assert.equal(stageForPlans([{ id: 'p1' }]), STAGE_PLAN);
});

test('the current plan is the newest active one', () => {
  const plans = [
    { id: 'old', status: 'active', created_at: '2026-01-01T00:00:00Z' },
    { id: 'new', status: 'active', created_at: '2026-05-01T00:00:00Z' },
  ];
  assert.equal(currentPlan(plans).id, 'new');
  // Arrival order must not decide it.
  assert.equal(currentPlan([...plans].reverse()).id, 'new');
});

test('an archived plan does not hide an active one', () => {
  const plans = [
    { id: 'archived', status: 'archived', created_at: '2026-06-01T00:00:00Z' },
    { id: 'active', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  ];
  assert.equal(currentPlan(plans).id, 'active');
});

test('with no active plan, the newest of what there is still shows', () => {
  const plans = [
    { id: 'a', status: 'completed', created_at: '2026-01-01T00:00:00Z' },
    { id: 'b', status: 'completed', created_at: '2026-05-01T00:00:00Z' },
  ];
  assert.equal(currentPlan(plans).id, 'b');
  assert.equal(currentPlan([]), null);
  assert.equal(currentPlan(null), null);
});

// ─── "Not started" and "measured at zero" are different claims ───────────────

test('a plan nobody has been assessed on does not say 0% ready', () => {
  const headline = readinessHeadline({
    readiness: 0,
    topics_total: 4,
    topics_assessed: 0,
  });
  assert.equal(headline.kind, 'unmeasured');
  assert.equal(headline.percent, null);
});

test('a real figure is reported as a percentage', () => {
  const headline = readinessHeadline({
    readiness: 0.42,
    topics_total: 4,
    topics_assessed: 3,
  });
  assert.deepEqual(headline, { kind: 'measured', percent: 42 });
});

test('a measured zero is still a measurement', () => {
  // Assessed on every topic and demonstrated nothing. That is a real 0%, and
  // unlike the untouched case it is a claim the evidence supports.
  const headline = readinessHeadline({
    readiness: 0,
    topics_total: 2,
    topics_assessed: 2,
  });
  assert.deepEqual(headline, { kind: 'measured', percent: 0 });
});

test('a test with no topics has no readiness to report', () => {
  assert.equal(readinessHeadline({ topics_total: 0, topics_assessed: 0 }).kind, 'unknown');
  assert.equal(readinessHeadline({ readiness: null, topics_total: 3, topics_assessed: 2 }).kind, 'unknown');
  assert.equal(readinessHeadline(null).kind, 'unknown');
  assert.equal(readinessHeadline(undefined).kind, 'unknown');
});

test('readiness is clamped rather than rendered past 100%', () => {
  const over = readinessHeadline({ readiness: 4, topics_total: 1, topics_assessed: 1 });
  assert.equal(over.percent, 100);
});

test('a topic never assessed reports not started, not zero', () => {
  assert.deepEqual(topicStanding({ topic: 'Mitosis', mastery: null }), {
    kind: 'not_started',
    percent: null,
  });
  assert.deepEqual(topicStanding({ topic: 'Mitosis' }), {
    kind: 'not_started',
    percent: null,
  });
});

test('a topic measured at zero reports zero', () => {
  assert.deepEqual(topicStanding({ topic: 'Mitosis', mastery: 0 }), {
    kind: 'measured',
    percent: 0,
  });
});

test('a topic with a real score reports it', () => {
  assert.equal(topicStanding({ topic: 'Mitosis', mastery: 0.625 }).percent, 63);
});

test('an unreadable mastery is not rendered as a number', () => {
  assert.equal(topicStanding({ mastery: 'soon' }).kind, 'unknown');
  assert.equal(topicStanding(null).kind, 'unknown');
});

// ─── The date ────────────────────────────────────────────────────────────────

test('the countdown reads as a sentence, including the awkward cases', () => {
  assert.equal(daysLabel(7), '7 days to go');
  assert.equal(daysLabel(1), '1 day to go');
  assert.equal(daysLabel(0), 'Your test is today');
  assert.equal(daysLabel(-3), 'This test has passed');
  assert.equal(daysLabel(null), null);
  assert.equal(daysLabel(undefined), null);
  assert.equal(daysLabel('soon'), null);
});

// ─── A session opens the Classroom under the shared rules ────────────────────

test('a review session enters review mode', () => {
  const href = sessionEntryHref({ topic: 'Long division', session_type: 'review' });
  assert.equal(new URL(href, 'http://x').searchParams.get('mode'), 'review');
});

test('a practice session does not enter review mode', () => {
  // A concept the learner is weak on has not been learned; asking them to
  // retrieve it tests a memory that was never formed, and a success would be
  // recorded as durable recall it is not.
  const href = sessionEntryHref({ topic: 'Long division', session_type: 'practice' });
  assert.equal(new URL(href, 'http://x').searchParams.get('mode'), null);
});

test('a learn session teaches rather than testing', () => {
  const href = sessionEntryHref({ topic: 'Long division', session_type: 'learn' });
  const params = new URL(href, 'http://x').searchParams;
  assert.equal(params.get('mode'), null);
  assert.equal(params.get('objective'), 'Understand and apply Long division');
});

test('an unrecognised session type is taught, never guessed into a mode', () => {
  for (const session_type of ['mock_test', 'seance', undefined]) {
    const href = sessionEntryHref({ topic: 'Long division', session_type });
    assert.equal(new URL(href, 'http://x').searchParams.get('mode'), null, String(session_type));
  }
});

test('a session carries its own topic through to the Classroom', () => {
  const href = sessionEntryHref({ topic: 'Compare fractions', session_type: 'practice' });
  assert.equal(new URL(href, 'http://x').searchParams.get('topic'), 'Compare fractions');
});

test('a session with no topic is not a destination', () => {
  assert.equal(sessionEntryHref({ topic: '', session_type: 'learn' }), null);
  assert.equal(sessionEntryHref({ session_type: 'learn' }), null);
  assert.equal(sessionEntryHref(null), null);
});

// ─── Today's list ────────────────────────────────────────────────────────────

test('finished sessions drop off the list', () => {
  const sessions = [
    { id: 'a', status: 'completed', scheduled_at: '2026-05-10T09:00:00Z' },
    { id: 'b', status: 'scheduled', scheduled_at: '2026-05-10T10:00:00Z' },
    { id: 'c', status: 'skipped', scheduled_at: '2026-05-10T11:00:00Z' },
  ];
  assert.deepEqual(openSessions(sessions).map((s) => s.id), ['b']);
});

test('what is due soonest comes first', () => {
  const sessions = [
    { id: 'late', status: 'scheduled', scheduled_at: '2026-05-10T18:00:00Z' },
    { id: 'early', status: 'scheduled', scheduled_at: '2026-05-10T08:00:00Z' },
  ];
  assert.deepEqual(openSessions(sessions).map((s) => s.id), ['early', 'late']);
});

test('a session in progress is still open', () => {
  const sessions = [{ id: 'a', status: 'in_progress', scheduled_at: '2026-05-10T09:00:00Z' }];
  assert.equal(openSessions(sessions).length, 1);
});

test('a missing list is an empty list, not a crash', () => {
  assert.deepEqual(openSessions(null), []);
  assert.deepEqual(openSessions(undefined), []);
});

// ─── The server decides when intake is done ──────────────────────────────────

test('intake finishes when the server says so and names the profile', () => {
  assert.equal(intakeIsComplete({ intake_complete: true, test_profile_id: 'p1' }), true);
  // Complete but no profile id is not something we can generate a plan from.
  assert.equal(intakeIsComplete({ intake_complete: true }), false);
  assert.equal(intakeIsComplete({ intake_complete: false, test_profile_id: 'p1' }), false);
  assert.equal(intakeIsComplete({ test_profile_id: 'p1' }), false);
  assert.equal(intakeIsComplete(null), false);
});

test('a truthy-but-not-true completion flag does not end intake', () => {
  // The client must not decide intake is over because the field was present.
  assert.equal(intakeIsComplete({ intake_complete: 'yes', test_profile_id: 'p1' }), false);
  assert.equal(intakeIsComplete({ intake_complete: 1, test_profile_id: 'p1' }), false);
});
