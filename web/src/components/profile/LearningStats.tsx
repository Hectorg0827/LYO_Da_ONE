'use client';

import { motion } from 'framer-motion';
import { Clock, BookOpen, Flame, CheckCircle } from 'lucide-react';
import { LearningStats } from '@/types';

interface LearningStatsProps {
  stats: LearningStats;
}

/**
 * Learning stats panel.
 *
 * Everything rendered here is sourced from `stats`, which the profile pages
 * build from the real gamification + course endpoints. This component
 * deliberately owns no sample, seeded or generated data of its own: a panel
 * that invents the learner's history is worse than a panel that admits it
 * has none yet.
 *
 * Two blocks were removed for that reason and should not come back without a
 * real endpoint behind them:
 *
 *  - a 28-day "Activity Calendar" whose squares came from `Math.random()`,
 *    presented to the learner as their own study history;
 *  - a "Recent Achievements" grid with hard-coded badges and three
 *    arbitrarily marked unlocked. Real achievements already render from
 *    `api.gamification.achievements()` under the profile's Achievements tab,
 *    so this was both fabricated and a duplicate.
 *
 * See docs/CLASSROOM_ARCHITECTURE.md section 5.
 */

// ── Animation ────────────────────────────────────────────────────────────────

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  sub,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string | number;
  color: string;
  sub?: string;
}) {
  return (
    <motion.div variants={itemVariants} className="glass-card p-4 space-y-3">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: `${color}20` }}
      >
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <p className="text-2xl font-black text-primary leading-none">{value}</p>
        {sub && <p className="text-xs text-secondary mt-0.5">{sub}</p>}
      </div>
      <p className="text-xs font-medium text-secondary">{label}</p>
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function LearningStatsPanel({ stats }: LearningStatsProps) {
  const topTopics = stats.topTopics ?? [];
  const maxTopicHours = Math.max(...topTopics.map((t) => t.hours), 1);

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Stat Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={Clock}
          label="Hours Learned"
          value={stats.totalHoursLearned}
          color="#6366f1"
          sub="total"
        />
        <StatCard
          icon={BookOpen}
          label="Courses Completed"
          value={stats.coursesCompleted}
          color="#22c55e"
          sub={`${stats.coursesInProgress} in progress`}
        />
        <StatCard
          icon={Flame}
          label="Current Streak"
          value={`${stats.currentStreak}d`}
          color="#f59e0b"
          sub={`Best: ${stats.longestStreak}d`}
        />
        <StatCard
          icon={CheckCircle}
          label="Quizzes Passed"
          value={stats.quizzesPassed}
          color="#3b82f6"
          sub={`${stats.xpThisWeek} XP this week`}
        />
      </div>

      {/* Top Topics — only when the learner actually has tracked topics.
          An empty chart frame taught nobody anything. */}
      {topTopics.length > 0 && (
        <motion.div variants={itemVariants} className="glass-card p-5">
          <h3 className="text-sm font-bold text-primary mb-4">Top Topics</h3>
          <div className="space-y-3">
            {topTopics.map((topic, i) => {
              const pct = Math.round((topic.hours / maxTopicHours) * 100);
              const colors = ['#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899'];
              const color = colors[i % colors.length];
              return (
                <div key={topic.topic} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-primary">{topic.topic}</span>
                    <span className="text-secondary">{topic.hours}h</span>
                  </div>
                  <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: i * 0.1 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
