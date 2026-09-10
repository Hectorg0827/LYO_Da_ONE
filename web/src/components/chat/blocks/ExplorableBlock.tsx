'use client';

import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import {
  canRenderExplorable,
  positionField,
  trackOffsets,
} from '@/lib/explorable.mjs';
import type { ExplorableContent } from '@/lib/explorable';
import type { ChatBlock } from '@/types';

/**
 * A representation the learner can move through, rather than only read.
 *
 * Every subject was getting the same treatment: prose, then a multiple-choice
 * question. A number line for fractions and a timeline for a sequence of
 * events are not decoration — they are how those subjects are actually
 * thought about, and placing a fraction is a different act from reading about
 * one.
 *
 * WHAT ENGAGING WITH IT PROVES
 *
 * Exposure, and nothing more. The learner met the idea; they have not shown
 * they can use it. The check below the explorable is still where a
 * demonstration happens. The server enforces this rather than trusting us:
 * events posted from a client are recorded as exposure whatever they claim,
 * so this component *cannot* inflate anyone's mastery even if it were wrong.
 */

export default function ExplorableBlock({ block }: { block: ChatBlock }) {
  // The cast is unchecked either way — `block.content` is an untyped payload
  // from the wire. `canRenderExplorable` below is what actually validates it,
  // at runtime, before anything is read.
  const content = block.content as unknown as ExplorableContent;
  const conceptId = (block.metadata as { concept_id?: string } | undefined)?.concept_id;

  const [active, setActive] = useState<number | null>(null);
  // One exposure per explorable per session. Recording every drag would say
  // more about restlessness than about learning.
  const recorded = useRef(false);

  const points = useMemo(() => content?.points ?? [], [content]);
  const isTimeline = positionField(content?.kind) === 'year';
  const offsets = useMemo(
    () => trackOffsets(points, content?.kind),
    [points, content]
  );

  if (!canRenderExplorable(content)) return null;

  const engage = (index: number) => {
    setActive(index);
    if (recorded.current || !conceptId) return;
    recorded.current = true;
    // Best effort. A learner exploring an idea must never be interrupted by
    // bookkeeping, and the server decides what this is worth regardless.
    void api.learning.recordExposure(conceptId).catch(() => {});
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
      <p className="text-sm text-white/70 mb-5">{content.prompt}</p>

      <div className="relative h-20 mx-2">
        <div className="absolute left-0 right-0 top-8 h-px bg-white/20" />

        {points.map((point, index) => {
          const selected = active === index;
          const reading = isTimeline ? point.year : point.value;
          return (
            <button
              key={`${point.label}-${index}`}
              type="button"
              onClick={() => engage(index)}
              aria-pressed={selected}
              aria-label={`${point.label}${reading != null ? `, ${reading}` : ''}`}
              className="absolute -translate-x-1/2 flex flex-col items-center gap-1 group"
              style={{ left: `${offsets[index] * 100}%`, top: 0 }}
            >
              <span
                className={cn(
                  'text-[11px] leading-tight max-w-[84px] text-center transition-colors',
                  selected ? 'text-white' : 'text-white/50 group-hover:text-white/80'
                )}
              >
                {point.label}
              </span>
              <span
                className={cn(
                  'mt-1 rounded-full border transition-all',
                  selected
                    ? 'w-3.5 h-3.5 bg-lyo-400 border-lyo-300'
                    : 'w-2.5 h-2.5 bg-white/30 border-white/40 group-hover:bg-white/60'
                )}
              />
              {reading != null && (
                <span
                  className={cn(
                    'text-[10px] tabular-nums transition-colors',
                    selected ? 'text-lyo-300' : 'text-white/30'
                  )}
                >
                  {reading}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
