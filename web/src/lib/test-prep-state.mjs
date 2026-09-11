/**
 * The Test Prep page's state transitions, in one place that can be tested.
 *
 * Extracted after four consecutive review findings in the same component,
 * each one a different combination of eighteen pieces of `useState` and
 * `useRef` — and the last of them a defect in the fix for the one before it.
 * That is the same shape as the `request()` 401 branch, which was wrong three
 * rounds running until the decision moved into `auth-failure.mjs`, and the
 * same remedy applies: a component cannot be unit-tested here, a reducer can.
 *
 * The rules these transitions exist to hold, all of them learned the hard way:
 *
 * - **A failed request is never a fact about the learner.** Not "no sessions
 *   today", not "you have no plan". Each failure has somewhere to be said.
 * - **A refresh never destroys what is on screen.** The completion summary was
 *   invisible for a whole commit because the refresh unmounted the row that
 *   carried it.
 * - **Finishing a session updates the list locally**, so the row stops looking
 *   open even if the refresh that would have removed it never lands.
 */

/** @type {import('../types').TestPrepState} */
export const initialState = {
  stage: 'intake',
  loading: true,
  loadedOnce: false,
  planId: null,
  readiness: null,
  sessions: [],
  /** The sessions call failed; the list on screen may be stale or empty. */
  sessionsFailed: false,
  /** A refresh failed while we already have a plan. Shown on the plan view. */
  refreshFailed: false,
  /** The plan list failed and we have never seen a plan. Shown on intake. */
  planLoadFailed: false,
  /** What the server measured for the session just finished. */
  notice: null,
  /** Id of the session currently being closed out, if any. */
  finishing: null,
};

/**
 * `allowJs` is on, so TypeScript reads this file rather than a sibling `.d.ts`
 * — these annotations are what give the page a typed `dispatch`.
 *
 * @param {import('../types').TestPrepState} [state]
 * `action` is required rather than optional: React's `useReducer` has a
 * separate overload for reducers that take no action, and an optional second
 * parameter matches it — which types `dispatch` as taking nothing at all.
 * @param {import('../types').TestPrepAction | undefined} action
 * @returns {import('../types').TestPrepState}
 */
export function testPrepReducer(state = initialState, action) {
  switch (action?.type) {
    case 'load_started':
      return {
        ...state,
        // Only the first load blanks the page. A refresh that unmounts the
        // plan view takes whatever the learner was reading with it.
        loading: !state.loadedOnce,
        refreshFailed: false,
        planLoadFailed: false,
      };

    case 'plan_loaded':
      return { ...state, stage: 'plan', planId: action.planId };

    case 'no_plan':
      // Only ever reached from a *successful* call that returned no plans.
      // A failure takes `load_failed`, which does not conclude anything about
      // whether the learner has a plan.
      return { ...state, stage: 'intake', planId: null };

    case 'details_loaded': {
      const next = { ...state };
      if (action.readiness !== undefined) next.readiness = action.readiness;
      if (action.sessions !== undefined) {
        next.sessions = action.sessions;
        next.sessionsFailed = false;
      } else {
        // Keep whatever was legitimately shown a moment ago; say the call
        // failed rather than rendering an empty day.
        next.sessionsFailed = true;
      }
      return next;
    }

    case 'load_failed':
      // A failed request is not evidence the plan is gone. Sending a learner
      // who has a plan to intake would have them build a second one because a
      // request happened to fail.
      return state.planId
        ? { ...state, refreshFailed: true }
        : { ...state, stage: 'intake', planLoadFailed: true };

    case 'load_settled':
      return { ...state, loading: false, loadedOnce: true };

    case 'finish_started':
      return { ...state, finishing: action.sessionId, notice: null };

    case 'finish_succeeded':
      return {
        ...state,
        finishing: null,
        notice: action.notice,
        // Dropped locally rather than waiting for the refresh to drop it. If
        // that refresh fails, the row would otherwise sit there looking open
        // while the server considers it closed — and a second click would
        // replace the score the learner is still reading.
        sessions: state.sessions.filter((session) => session?.id !== action.sessionId),
      };

    case 'finish_failed':
      return { ...state, finishing: null, notice: action.notice };

    default:
      return state;
  }
}

/**
 * A page-level note that what is shown may be out of date.
 *
 * Deliberately *only* about the whole-page refresh. It used to also report a
 * failed sessions call, which meant the same sentence appeared twice on an
 * empty day — once in the header and once as the Today copy — and, worse, a
 * page refresh failure overwrote "Nothing scheduled for today" even when the
 * sessions list was known-good and genuinely empty.
 *
 * @param {import('../types').TestPrepState | null | undefined} state
 * @returns {string | null}
 */
export function staleWarning(state) {
  if (!state?.refreshFailed) return null;
  return 'I could not refresh this just now, so it may be out of date.';
}

/**
 * What the Today section says when it has no sessions to show.
 *
 * Returns null when the list is legitimately empty — the caller supplies
 * "Nothing scheduled for today" — and a sentence only when the sessions call
 * itself failed, which is a fact about the request and not about the day.
 *
 * @param {import('../types').TestPrepState | null | undefined} state
 * @returns {string | null}
 */
export function sessionsNote(state) {
  if (!state?.sessionsFailed) return null;
  return 'I could not load today’s sessions just now.';
}
