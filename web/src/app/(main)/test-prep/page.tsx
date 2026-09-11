'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, GraduationCap, Loader2, Send, Target } from 'lucide-react';

import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { TEST_PREP_OPENING_TURN, testPrepEntryHref } from '@/lib/entry-contract.mjs';
import {
  STAGE_PLAN,
  completionSummary,
  currentPlan,
  daysLabel,
  intakeIsComplete,
  openSessions,
  readinessHeadline,
  sessionEntryHref,
  stageForPlans,
  topicStanding,
} from '@/lib/test-prep.mjs';
import {
  initialState,
  sessionsNote,
  staleWarning,
  testPrepReducer,
} from '@/lib/test-prep-state.mjs';
import type { ReadinessPayload, StudySessionRow } from '@/types';

/**
 * Test Prep — the face on a learner loop that had none.
 *
 * The server has been able to answer "how ready am I for Friday, and what
 * should I do first" since Phase E, and no client asked. Worse, no client
 * could create the plan it reports on: the only writers of TestProfile,
 * StudyPlan and StudySession are `intake_turn` and `plans/generate`, and
 * nothing called either, so those tables were empty for every learner on
 * every platform.
 *
 * So this page is both halves. A learner with no plan is asked about their
 * test — the server's own intake coach, one question at a time — and the
 * answers become a real plan with scheduled sessions. A learner with a plan
 * sees where they actually stand and can step from a session straight into
 * the Classroom.
 *
 * What it will not do is show a number nobody measured. A plan with nothing
 * assessed yet carries a readiness of 0, and "0% ready" is a claim about a
 * person that no evidence supports. The rules for that live in
 * `test-prep.mjs`, tested, because they are exactly the rules this codebase
 * keeps getting wrong.
 *
 * See docs/CLASSROOM_ARCHITECTURE.md §7.5.
 */

type Turn = { role: 'coach' | 'learner'; text: string };

export default function TestPrepPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();

  // One reducer rather than eighteen useStates. Four consecutive review
  // findings on this page were different combinations of that state, the last
  // of them a defect in the fix for the one before — the same shape as the
  // 401 branch, and the same remedy: put the transitions somewhere they can
  // be unit-tested. See test-prep-state.mjs.
  const [state, dispatch] = useReducer(testPrepReducer, initialState);
  const { loading, stage, planId, readiness, sessions, finishing, notice } = state;
  const failed = state.planLoadFailed;

  // Intake conversation
  const [turns, setTurns] = useState<Turn[]>([]);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [building, setBuilding] = useState(false);
  const startedIntake = useRef(false);

  const loadPlan = useCallback(async () => {
    dispatch({ type: 'load_started' });
    try {
      const plans = await api.testPrep.plans();
      if (stageForPlans(plans) !== STAGE_PLAN) {
        dispatch({ type: 'no_plan' });
        return;
      }
      const plan = currentPlan(plans);
      if (!plan) {
        dispatch({ type: 'no_plan' });
        return;
      }
      dispatch({ type: 'plan_loaded', planId: plan.id });

      // Settled rather than all: one failing must not blank the other, and
      // neither may be replaced by a placeholder.
      const [readinessResult, sessionsResult] = await Promise.allSettled([
        api.testPrep.readiness(plan.id),
        api.testPrep.todaySessions(),
      ]);
      dispatch({
        type: 'details_loaded',
        readiness: readinessResult.status === 'fulfilled' ? readinessResult.value : undefined,
        sessions: sessionsResult.status === 'fulfilled' ? sessionsResult.value ?? [] : undefined,
      });
    } catch {
      dispatch({ type: 'load_failed' });
    } finally {
      dispatch({ type: 'load_settled' });
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      // A guest has nothing to load; leaving `loading` true would hold them
      // on the spinner forever.
      dispatch({ type: 'load_settled' });
      return;
    }
    void loadPlan();
  }, [authLoading, isAuthenticated, loadPlan]);

  const sendTurn = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || sending) return;
      setSending(true);
      setTurns((prev) => [...prev, { role: 'learner', text }]);
      setDraft('');
      try {
        const turn = await api.testPrep.intakeTurn(text, profileId);
        setProfileId(turn.test_profile_id);
        setTurns((prev) => [...prev, { role: 'coach', text: turn.message_to_user }]);

        // The server decides when it has enough, not a turn count here.
        if (intakeIsComplete(turn)) {
          setBuilding(true);
          await api.testPrep.generatePlan(turn.test_profile_id);
          await loadPlan();
        }
      } catch {
        setTurns((prev) => [
          ...prev,
          {
            role: 'coach',
            text: 'Something went wrong on my side. Could you say that again?',
          },
        ]);
      } finally {
        setSending(false);
        setBuilding(false);
      }
    },
    [loadPlan, profileId, sending]
  );

  const finishSession = useCallback(
    async (sessionId: string) => {
      if (finishing) return;
      dispatch({ type: 'finish_started', sessionId });
      try {
        const summary = completionSummary(await api.testPrep.completeSession(sessionId));

        // Say what the server measured, including when it measured nothing.
        // The client sends no score and must not imply one: "done" with a
        // silent 0% would be the fabrication this endpoint was fixed to stop.
        const text =
          summary.kind === 'scored'
            ? `Scored ${summary.percent}% from ${summary.graded} graded ${
                summary.graded === 1 ? 'answer' : 'answers'
              }.`
            : summary.kind === 'unscored'
              ? 'Marked done. Nothing in this session was graded, so there is no score — answer a check in the Classroom and it will count.'
              : summary.kind === 'empty'
                ? 'Marked done. Nothing was recorded for this session.'
                : 'Marked done, but I could not read what was measured.';

        dispatch({ type: 'finish_succeeded', sessionId, notice: text });
        await loadPlan();
      } catch {
        dispatch({
          type: 'finish_failed',
          notice: 'I could not mark that done just now.',
        });
      }
    },
    [finishing, loadPlan]
  );

  // Open with the coach's first question rather than an empty box, so the
  // learner is asked something instead of being left to guess the format.
  //
  // The opening line is the same constant Home's "I have a test" sends into
  // Chat. Two surfaces opening test prep with two different sentences is how
  // they start being two different features.
  useEffect(() => {
    if (stage !== 'intake' || !isAuthenticated || loading || startedIntake.current) return;
    startedIntake.current = true;
    void sendTurn(TEST_PREP_OPENING_TURN);
  }, [stage, isAuthenticated, loading, sendTurn]);

  if (authLoading || loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center text-white/60">
        <Loader2 className="mx-auto h-6 w-6 animate-spin" aria-hidden />
        <p className="mt-3 text-sm">Loading your test prep…</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-2xl font-semibold text-white">Get ready for your test</h1>
        <p className="mt-3 text-white/70">
          A study plan is tied to your account, so you&apos;ll need to sign in to build one. You
          can start talking it through right now without an account.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/auth/login"
            className="rounded-xl bg-white px-5 py-3 font-medium text-black"
          >
            Sign in
          </Link>
          <Link
            href={testPrepEntryHref()}
            className="rounded-xl border border-white/15 px-5 py-3 font-medium text-white"
          >
            Just talk it through
          </Link>
        </div>
      </main>
    );
  }

  if (stage === 'intake') {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-white">Tell me about your test</h1>
        <p className="mt-2 text-sm text-white/60">
          A few questions — the subject, the date, what&apos;s on it — and I&apos;ll build you a
          plan with real sessions.
        </p>
        {failed && (
          <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            I couldn&apos;t load your existing plans just now, so this will start a new one.
          </p>
        )}

        <div className="mt-6 space-y-3">
          {turns.map((turn, index) => (
            <div
              key={`${turn.role}-${index}`}
              className={
                turn.role === 'coach'
                  ? 'rounded-2xl bg-white/[0.06] px-4 py-3 text-white/90'
                  : 'ml-auto max-w-[85%] rounded-2xl bg-white/15 px-4 py-3 text-white'
              }
            >
              {turn.text}
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {building ? 'Building your plan…' : 'Thinking…'}
            </div>
          )}
        </div>

        <form
          className="mt-6 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendTurn(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type your answer…"
            aria-label="Your answer"
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none placeholder:text-white/40"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-xl bg-white px-4 py-3 text-black disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-4 w-4" aria-hidden />
          </button>
        </form>
      </main>
    );
  }

  // Every failure has somewhere to be said. `refreshFailed` was previously
  // set and rendered nowhere, which is how a failed refresh after finishing a
  // session became completely silent.
  const stale = staleWarning(state);
  const headline = readinessHeadline(readiness);
  const countdown = daysLabel(readiness?.days_remaining);
  const due = openSessions(sessions);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-white">
          {readiness?.subject ?? 'Your test'}
        </h1>
        {countdown && <p className="mt-1 text-sm text-white/60">{countdown}</p>}
        {stale && (
          <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-200">
            {stale}
          </p>
        )}
      </header>

      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="flex items-center gap-2 text-sm text-white/60">
          <Target className="h-4 w-4" aria-hidden />
          How ready you are
        </div>

        {/* Each branch is a different claim. A plan with nothing assessed has
            a readiness of 0, and rendering that as "0%" would tell a learner
            they failed something nobody ever asked them. */}
        {headline.kind === 'measured' && (
          <p className="mt-2 text-4xl font-semibold text-white">{headline.percent}%</p>
        )}
        {headline.kind === 'unmeasured' && (
          <p className="mt-2 text-lg text-white/80">
            You haven&apos;t been tested on any of this yet — start a session below and this
            will start filling in.
          </p>
        )}
        {headline.kind === 'unknown' && (
          <p className="mt-2 text-lg text-white/80">
            {readiness
              ? 'This plan has no topics on it yet, so there is nothing to measure.'
              : 'I could not load your readiness just now.'}
          </p>
        )}

        {readiness && readiness.topics.length > 0 && (
          <ul className="mt-5 space-y-2">
            {readiness.topics.map((topic) => {
              const standing = topicStanding(topic);
              return (
                <li
                  key={topic.concept_id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-white/80">{topic.topic}</span>
                  <span className="shrink-0 text-white/50">
                    {standing.kind === 'measured' ? `${standing.percent}%` : 'Not started'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {readiness && readiness.focus_next.length > 0 && (
          <p className="mt-5 text-sm text-white/70">
            Start with <span className="text-white">{readiness.focus_next[0]}</span>.
          </p>
        )}
      </section>

      <section className="mt-6">
        <div className="flex items-center gap-2 text-sm text-white/60">
          <CalendarClock className="h-4 w-4" aria-hidden />
          Today
        </div>

        {notice && (
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/80">
            {notice}
          </p>
        )}

        {due.length === 0 ? (
          <p className="mt-3 text-sm text-white/60">
            {sessionsNote(state) ?? 'Nothing scheduled for today.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {due.map((session) => {
              const href = sessionEntryHref(session);
              const body = (
                <>
                  <span className="flex-1 text-white/90">{session.topic}</span>
                  <span className="shrink-0 text-xs uppercase tracking-wide text-white/40">
                    {session.session_type}
                  </span>
                </>
              );
              return (
                <li key={session.id}>
                  <div className="flex items-stretch gap-2">
                    {href ? (
                      <Link
                        href={href}
                        className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 hover:bg-white/[0.07]"
                      >
                        <GraduationCap className="h-4 w-4 text-white/50" aria-hidden />
                        {body}
                      </Link>
                    ) : (
                      // No topic means nothing to teach. A dead link into an
                      // empty Classroom is worse than a row that plainly is
                      // not one.
                      <div className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 px-4 py-3 opacity-60">
                        <GraduationCap className="h-4 w-4 text-white/50" aria-hidden />
                        {body}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void finishSession(session.id)}
                      disabled={finishing === session.id}
                      className="shrink-0 rounded-xl border border-white/10 px-3 text-sm text-white/70 hover:bg-white/[0.07] disabled:opacity-40"
                    >
                      {finishing === session.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        'Done'
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {planId && (
        <p className="mt-8 text-xs text-white/30">
          Readiness is measured from what you have actually demonstrated, not from sessions
          ticked off.
        </p>
      )}
    </main>
  );
}
