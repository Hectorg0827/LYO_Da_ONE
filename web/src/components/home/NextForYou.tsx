'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, GraduationCap, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatSkillLabel } from '@/lib/utils';
import { reviewEntryHref } from '@/lib/entry-contract.mjs';
import type { DueReviewItem } from '@/types';

/**
 * "What LYO recommends next" — the Home surface of the canonical learner
 * model.
 *
 * This block replaced a hard-coded "Daily Challenges" list whose progress
 * values ("1/2 lessons", "7/10 minutes") were invented constants shown to
 * every learner as their own activity, and which linked to a /challenges
 * route that does not exist.
 *
 * What it shows instead is real: concepts whose spaced-repetition schedule
 * says they are due for retrieval, from `api.chat.dueReviews()`. That signal
 * already existed but was reachable only from inside Chat — due reviews are a
 * property of the learner, not of a surface, so they belong here too.
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
  const [dueReviews, setDueReviews] = useState<DueReviewItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A signed-out visitor has no schedule; a failed call must leave the
    // section silent rather than inventing something to fill it.
    api.chat
      .dueReviews()
      .then(({ items }) => {
        if (!cancelled) setDueReviews(items ?? []);
      })
      .catch(() => {
        if (!cancelled) setDueReviews([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing due is not an empty state worth drawing a card for — it is simply
  // not this learner's next action. Stay out of the way.
  if (!loaded || dueReviews.length === 0) return null;

  return (
    <motion.div variants={itemVariants}>
      <div className="flex items-center gap-2 mb-4">
        <RotateCcw size={18} className="text-secondary" />
        <h2 className="font-rounded text-xl font-bold leading-tight">
          <span className="headline-gradient-text">Due for review</span>
        </h2>
      </div>

      <p className="text-[13px] text-secondary mb-3">
        {dueReviews.length === 1
          ? '1 concept is ready for a retrieval check.'
          : `${dueReviews.length} concepts are ready for a retrieval check.`}{' '}
        Recalling them now is what makes them stick.
      </p>

      <div className="space-y-3">
        {dueReviews.map((item) => (
          <Link
            key={item.skill_id}
            href={reviewEntryHref(formatSkillLabel(item.skill_id)) ?? '/classroom'}
            className="glass-card p-4 flex items-center gap-4 transition-all duration-200 hover:scale-[1.01]"
          >
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: 'rgba(245,158,11,0.12)',
                border: '1px solid rgba(245,158,11,0.25)',
              }}
            >
              <GraduationCap size={20} style={{ color: '#f59e0b' }} />
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-semibold text-primary truncate">
                {formatSkillLabel(item.skill_id)}
              </p>
              <p className="text-[11px] text-secondary truncate">
                {item.days_overdue > 0
                  ? `Due ${item.days_overdue}d ago`
                  : 'Due today'}
                {item.last_misconception ? ` · last time: ${item.last_misconception}` : ''}
              </p>
            </div>

            <span className="flex items-center gap-1 text-[13px] font-semibold text-[#A9B7FF] shrink-0">
              Review <ChevronRight size={14} />
            </span>
          </Link>
        ))}
      </div>
    </motion.div>
  );
}
