import type { HintLevel } from './classroom-contract';

export type EvidenceKind =
  | 'exposure'
  | 'recognition'
  | 'explanation'
  | 'application'
  | 'transfer'
  | 'retention';

export type MasteryState =
  | 'NOT_SEEN'
  | 'EXPOSED'
  | 'RECOGNIZED'
  | 'EXPLAINED'
  | 'APPLIED'
  | 'TRANSFERRED'
  | 'RETAINED'
  | 'MASTERED';

export interface Evidence {
  kind: EvidenceKind;
  confidence: number;
}

export interface LearnerConcept {
  conceptId: string | null;
  /** Canonical 0..1, or null when never assessed. */
  mastery: number | null;
  misconception: string | null;
  daysOverdue: number;
  dueForRetrieval: boolean;
}

export const EVIDENCE_KINDS: readonly EvidenceKind[];
export const MASTERY_STATES: readonly MasteryState[];
export const MASTERY_CONFIDENCE_FLOOR: number;

export function evidenceRank(kind: string | null | undefined): number;
/** Null for an unrecognised type — callers must not advance mastery on it. */
export function normalizeEvidenceKind(value: string | null | undefined): EvidenceKind | null;
export function isStrongerEvidence(a: string, b: string): boolean;

/** Canonical 0..1. Null means never assessed, which is not zero. */
export function normalizeMastery(value: number | null | undefined): number | null;
export function masteryPercent(value: number | null | undefined): number | null;

export function confidenceAfterHints(
  baseConfidence: number,
  hintLevel?: HintLevel | null,
): number;

export function deriveMasteryState(evidence?: Evidence[]): MasteryState;

export function transcriptLabelFor(evidenceType: string | null | undefined): string;

export function evidenceFromAnswerCheck(
  result: {
    correct?: boolean;
    bailed_out?: boolean;
    misconception?: string | null;
  } | null | undefined,
  options?: { hintLevel?: HintLevel | null },
): { evidence: Evidence[]; misconception: string | null; skipped: boolean };

export function evidenceFromClassroomSubmission(
  component: { evidence_type?: string; concept_id?: string | null } | null | undefined,
  options?: { accepted?: boolean; hintLevel?: HintLevel | null },
): { evidence: Evidence[]; conceptId: string | null };

export function conceptFromDueReview(item: {
  skill_id?: string;
  mastery_level?: number | null;
  last_misconception?: string | null;
  days_overdue?: number;
}): LearnerConcept;
