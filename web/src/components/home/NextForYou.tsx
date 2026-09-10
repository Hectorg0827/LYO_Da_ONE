'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, GraduationCap, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatSkillLabel } from '@/lib/utils';
import { reviewEntryHref } from '@/lib/entry-contract.mjs';
import { masteryPercent } from '@/lib/learner-model.mjs';
import type { Recommendation } from '@/types';

/**
 * "What LYO recommends next" — the Home surface of the canonical learner
 * model.
 *
 * This block replaced a hard-coded "Daily Challenges" list whose progress
 * values ("1/2 lessons", "7/10 minutes") were invented constants shown to
 * every learner as their own activity, and which linked to a /challenges
 * route that does not exist.
 *
 * What it shows instead is real: what the learner's own record says they
 * should do next, from `api.personalization.recommendations()` — concepts
 * whose spaced-repetition schedule says they are due for retrieval, and
 * concepts they are weakest on. Each carries the reason it was chosen.
 *
 * The reason is not decoration. "You slipped on sign error last time" is a
 * different thing to be shown than an unexplained card, and it is the only
 * version a learner can disagree with, which is what makes it honest rather
 * than oracular. Both signals already existed; neither was reachable from
 * Home, and due reviews were reachable only from inside Chat.
 *
 * Tapping a review enters the Classroom in `review` mode rather than
 * replaying the old question, so retrieval is generated fresh and the
 * attempt produces retention evidence on the canonical learner record.
 *
 * See docs/CLASSROOM_ARCHITECTURE.md sections 5 and 6.
 */

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
};

export default function NextForYou() {
  const [items, setItems] = useState<Recommendation[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A signed-out visitor has no record; a failed call must leave the section
    // silent rather than inventing something to fill it.
    api.personalization
      .recommendations()
      .then((result) => {
        if (!cancelled) setItems(result?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to recommend is not an empty state worth drawing a card for — it
  // is simply not this learner's next action. Stay out of the way.
  if (!loaded || items.length === 0) return null;

  const dueCount = items.filter((item) => item.reason === 'due_for_review').length;

  return (
    <motion.div variants={itemVariants}>
      <div className="flex items-center gap-2 mb-4">
        <RotateCcw size={18} className="text-secondary" />
        <h2 className="font-rounded text-xl font-bold leading-tight">
          <span className="headline-gradient-text">Next for you</span>
        </h2>
      </div>

      <p className="text-[13px] text-secondary mb-3">
        {dueCount > 0
          ? `${dueCount === 1 ? '1 concept is' : `${dueCount} concepts are`} ready for a retrieval check. Recalling them now is what makes them stick.`
          : 'Picked from what you have been working on.'}
      </p>

      <div className="space-y-3">
        {items.map((item) => {
          // The mastery reading goes through the shared scale so Home, Chat
          // and the Classroom describe the same concept the same way.
          const percent = masteryPercent(item.mastery);
          const isDue = item.reason === 'due_for_review';
          return (
          <Link
            key={item.concept_id}
            href={reviewEntryHref(formatSkillLabel(item.concept_id)) ?? '/classroom'}
            className="glass-card p-4 flex items-center gap-4 transition-all duration-200 hover:scale-[1.01]"
          >
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: isDue ? 'rgba(245,158,11,0.12)' : 'rgba(99,102,241,0.12)',
                border: `1px solid ${isDue ? 'rgba(245,158,11,0.25)' : 'rgba(99,102,241,0.25)'}`,
              }}
            >
              <GraduationCap size={20} style={{ color: isDue ? '#f59e0b' : '#818cf8' }} />
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-semibold text-primary truncate">
                {formatSkillLabel(item.concept_id)}
              </p>
              <p className="text-[11px] text-secondary truncate">
                {/* Assembled server-side, so every client says the same thing
                    about the same learner. */}
                {item.detail}
                {/* Only stated when the server actually has a reading. A
                    concept that has never been assessed is not 0% mastered. */}
                {percent !== null ? ` · ${percent}% mastered` : ''}
              </p>
            </div>

            <span className="flex items-center gap-1 text-[13px] font-semibold text-[#A9B7FF] shrink-0">
              {isDue ? 'Review' : 'Practise'} <ChevronRight size={14} />
            </span>
          </Link>
          );
        })}
      </div>
    </motion.div>
  );
}
