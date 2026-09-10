export type ExplorableKind = 'number_line' | 'timeline';

export interface ExplorablePoint {
  label: string;
  value?: number | null;
  year?: number | null;
}

export interface ExplorableContent {
  kind: ExplorableKind;
  prompt: string;
  points: ExplorablePoint[];
}

export const EXPLORABLE_KINDS: readonly ExplorableKind[];
export const EXPLORABLE_EVIDENCE_KIND: 'exposure';

export function positionField(kind: string | null | undefined): 'value' | 'year';
export function trackOffsets(
  points: ExplorablePoint[] | null | undefined,
  kind: string | null | undefined,
): number[];
/**
 * A type predicate, so a caller that has checked does not have to re-narrow.
 * The runtime function verifies exactly these fields.
 */
export function canRenderExplorable(content: unknown): content is ExplorableContent;
