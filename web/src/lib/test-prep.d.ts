import type {
  IntakeTurn,
  ReadinessPayload,
  StudyPlanSummary,
  StudySessionRow,
} from '@/types';

export const STAGE_INTAKE: 'intake';
export const STAGE_PLAN: 'plan';

/**
 * What a number means, kept apart from the number itself.
 *
 * `unmeasured` and a measured zero would render as the same figure and are
 * different claims about a person, so callers must branch on `kind` rather
 * than reading `percent ?? 0`.
 */
export type Standing =
  | { kind: 'measured'; percent: number }
  | { kind: 'unmeasured'; percent: null }
  | { kind: 'not_started'; percent: null }
  | { kind: 'unknown'; percent: null };

export function stageForPlans(plans: unknown): 'intake' | 'plan';
export function currentPlan(plans: unknown): StudyPlanSummary | null;
export function readinessHeadline(readiness: unknown): Standing;
export function topicStanding(topic: unknown): Standing;
export function daysLabel(daysRemaining: number | null | undefined): string | null;
export function sessionEntryHref(session: unknown): string | null;
export function openSessions(sessions: unknown): StudySessionRow[];
export function intakeIsComplete(turn: unknown): boolean;
export type { IntakeTurn, ReadinessPayload, StudyPlanSummary, StudySessionRow };
