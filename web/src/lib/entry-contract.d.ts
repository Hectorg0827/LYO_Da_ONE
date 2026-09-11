import type { ClassroomMode } from './classroom-contract';

export interface ClassroomEntry {
  topic: string;
  mode?: ClassroomMode | string;
  objective?: string;
  courseId?: string;
  lessonId?: string;
}

export const TEST_PREP_OPENING_TURN: string;
export function defaultObjective(topic: string): string;
/** Returns null when the topic is empty. */
export function classroomEntryHref(entry: ClassroomEntry): string | null;
export function reviewEntryHref(conceptLabel: string): string | null;
export function testPrepEntryHref(): string;

export function shouldShowLearnerDashboard(state: {
  authLoading?: boolean;
  isAuthenticated?: boolean;
  hasRealActivity?: boolean;
}): boolean;

/**
 * Open the Classroom to practise a weak concept. Not review mode: retrieval
 * of something never learned would be recorded as retention it is not.
 */
export function practiceEntryHref(conceptLabel: string): string | null;
