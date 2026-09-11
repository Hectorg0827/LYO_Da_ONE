/**
 * Test Prep — what a learner is told about a test they have coming up.
 *
 * The server can now answer "how ready am I, and what should I do first"
 * (`GET /me/study_plans/plans/{id}/readiness`). Nothing showed it to anybody,
 * and nothing on any client could even create the plan it reports on, so the
 * whole chain existed and reached no one.
 *
 * The rules for turning that answer into words live here rather than in the
 * page, because they are exactly the rules this workstream keeps getting
 * wrong: the difference between "nothing measured yet" and "measured, nothing
 * demonstrated". Those are one number apart and a world apart in what they
 * claim about a person.
 *
 * `.mjs` so the Node test runner and the CI gates can import it directly,
 * matching entry-contract.mjs and learner-model.mjs.
 */

import {
  classroomEntryHref,
  defaultObjective,
  practiceEntryHref,
  reviewEntryHref,
} from './entry-contract.mjs';

/** A learner with no plan is asked about their test before anything is shown. */
export const STAGE_INTAKE = 'intake';
/** A plan exists; show readiness and today's sessions. */
export const STAGE_PLAN = 'plan';

/**
 * Which stage is this learner at?
 *
 * An empty plan list is the normal first state, not an error, and it is what
 * every learner sees today. It must lead to the question that creates a plan,
 * never to an empty readiness card.
 */
export function stageForPlans(plans) {
  return Array.isArray(plans) && plans.length > 0 ? STAGE_PLAN : STAGE_INTAKE;
}

/**
 * The most recent active plan, or null.
 *
 * `list_plans` returns active plans newest-last is not guaranteed, so order by
 * `created_at` rather than trusting arrival order.
 */
export function currentPlan(plans) {
  if (!Array.isArray(plans) || plans.length === 0) return null;
  const active = plans.filter((plan) => plan && plan.status === 'active');
  const pool = active.length > 0 ? active : plans.filter(Boolean);
  if (pool.length === 0) return null;
  return pool.reduce((newest, plan) => {
    const a = Date.parse(plan.created_at ?? '');
    const b = Date.parse(newest.created_at ?? '');
    if (!Number.isFinite(a)) return newest;
    if (!Number.isFinite(b)) return plan;
    return a > b ? plan : newest;
  });
}

/**
 * What to say about readiness.
 *
 * Returns `{ kind, percent }`. The three kinds are genuinely different claims:
 *
 * - `unmeasured` — a plan exists but nothing on it has been assessed. The
 *   honest sentence is "you haven't started yet", not "0% ready". Both would
 *   render the same number; only one of them is true about the learner.
 * - `unknown` — the profile lists no usable topics, so there is nothing to be
 *   ready *for* and a percentage would be about nothing.
 * - `measured` — a real figure, rounded for display only.
 */
export function readinessHeadline(readiness) {
  if (!readiness || typeof readiness !== 'object') return { kind: 'unknown', percent: null };

  const assessed = Number(readiness.topics_assessed);
  const total = Number(readiness.topics_total);

  if (!Number.isFinite(total) || total <= 0) return { kind: 'unknown', percent: null };
  if (!Number.isFinite(assessed) || assessed <= 0) return { kind: 'unmeasured', percent: null };

  // Checked before coercing, because `Number(null)` is 0 — so a null figure
  // would otherwise be reported as "0% ready", which is the precise
  // fabrication this module exists to prevent. The server only returns null
  // when there are no topics, which the guard above already catches, but the
  // client must not depend on the server never changing its mind.
  if (readiness.readiness === null || readiness.readiness === undefined) {
    return { kind: 'unknown', percent: null };
  }
  const value = Number(readiness.readiness);
  if (!Number.isFinite(value)) return { kind: 'unknown', percent: null };

  return { kind: 'measured', percent: Math.round(Math.max(0, Math.min(1, value)) * 100) };
}

/**
 * How a single topic's standing reads.
 *
 * `mastery: null` means never assessed. Rendering that as 0% would tell a
 * learner they failed something nobody ever asked them.
 */
export function topicStanding(topic) {
  if (!topic || typeof topic !== 'object') return { kind: 'unknown', percent: null };
  if (topic.mastery === null || topic.mastery === undefined) {
    return { kind: 'not_started', percent: null };
  }
  const value = Number(topic.mastery);
  if (!Number.isFinite(value)) return { kind: 'unknown', percent: null };
  return { kind: 'measured', percent: Math.round(Math.max(0, Math.min(1, value)) * 100) };
}

/**
 * How long until the test.
 *
 * `null` days means the profile carries no date. A negative count means the
 * test has been and gone, which the learner should be told plainly rather than
 * shown as "-3 days".
 */
export function daysLabel(daysRemaining) {
  if (daysRemaining === null || daysRemaining === undefined) return null;
  const days = Number(daysRemaining);
  if (!Number.isFinite(days)) return null;
  if (days < 0) return 'This test has passed';
  if (days === 0) return 'Your test is today';
  if (days === 1) return '1 day to go';
  return `${days} days to go`;
}

/**
 * Open the Classroom on a scheduled session.
 *
 * Routed through the entry contract rather than building a query string here,
 * so a session obeys the same rules every other surface does — in particular
 * that practice is not review. A "practice" session on a topic the learner has
 * not learned must not be opened in review mode, where a success would be
 * recorded as durable recall of something never learned.
 *
 * Returns null when there is no topic: a Classroom with nothing to teach is
 * not a destination, and the caller should render the row without a link.
 */
export function sessionEntryHref(session) {
  if (!session || typeof session !== 'object') return null;
  const topic = (session.topic ?? '').trim();
  if (!topic) return null;

  switch (session.session_type) {
    case 'review':
      return reviewEntryHref(topic);
    case 'practice':
      return practiceEntryHref(topic);
    default:
      // learn, mock_test, and anything a future planner invents: teach it.
      // Guessing a mode for an unrecognised type is how a new session type
      // would silently start writing the wrong kind of evidence.
      return classroomEntryHref({ topic, objective: defaultObjective(topic) });
  }
}

/** Sessions the learner has not finished yet, soonest first. */
export function openSessions(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter((s) => s && s.status !== 'completed' && s.status !== 'skipped')
    .sort((a, b) => {
      const at = Date.parse(a.scheduled_at ?? '');
      const bt = Date.parse(b.scheduled_at ?? '');
      if (!Number.isFinite(at)) return 1;
      if (!Number.isFinite(bt)) return -1;
      return at - bt;
    });
}

/**
 * Is the intake conversation finished and ready to become a plan?
 *
 * The server decides this (`intake_complete`), not the client counting turns.
 */
export function intakeIsComplete(turn) {
  return Boolean(turn && turn.intake_complete === true && turn.test_profile_id);
}

/**
 * What to tell a learner who just finished a session.
 *
 * This is the visible half of the Phase E trust fix. The client used to send
 * `performance_score` and the server stored whatever arrived; now the client
 * sends nothing and the server replies with what it actually measured. So the
 * only honest thing to show is that reply — including when the reply is
 * "nothing was graded", which is the common case for a session spent reading.
 *
 * Returns `{ kind, percent, graded, seen }`:
 *
 * - `scored` — the server graded work and derived a figure from it.
 * - `unscored` — the learner met the concept but nothing asked them to
 *   demonstrate it. Not a zero. Reporting it as one would invent the failure
 *   that removing client-sent scores was meant to stop.
 * - `empty` — the server saw nothing at all for this session.
 * - `unknown` — no usable reply; say so rather than assume it worked.
 */
export function completionSummary(result) {
  if (!result || typeof result !== 'object') {
    return { kind: 'unknown', percent: null, graded: 0, seen: 0 };
  }

  const graded = Number.isFinite(Number(result.graded)) ? Number(result.graded) : 0;
  const seen = Number.isFinite(Number(result.seen)) ? Number(result.seen) : 0;

  // Checked before coercing: `Number(null)` is 0, so a null score would
  // otherwise be reported as a graded zero — the learner measured and failed
  // at something nobody asked them.
  const hasScore = result.performance_score !== null && result.performance_score !== undefined;
  const score = hasScore ? Number(result.performance_score) : NaN;

  if (graded > 0 && Number.isFinite(score)) {
    return {
      kind: 'scored',
      percent: Math.round(Math.max(0, Math.min(1, score)) * 100),
      graded,
      seen,
    };
  }
  if (seen > 0 || graded > 0) {
    return { kind: 'unscored', percent: null, graded, seen };
  }
  return { kind: 'empty', percent: null, graded: 0, seen: 0 };
}
