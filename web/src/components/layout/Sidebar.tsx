'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  MessageSquare,
  BookOpen,
  Play,
  Users,
  Compass,
  Target,
  User,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/stores/auth-store';

/* ============================================================
   Nav item definitions
   ============================================================ */
const navItems = [
  { href: '/', icon: Home, label: 'Home' },
  { href: '/chat', icon: MessageSquare, label: 'LYO', isAI: true },
  { href: '/courses', icon: BookOpen, label: 'My Courses' },
  // Test prep is a distinct job from browsing courses: a learner with a date
  // in mind needs their readiness and today's sessions, not the catalogue.
  { href: '/test-prep', icon: Target, label: 'Test Prep' },
  { href: '/clips', icon: Play, label: 'Clips' },
  { href: '/community', icon: Users, label: 'Community' },
  { href: '/discover', icon: Compass, label: 'Discover' },
  { href: '/profile', icon: User, label: 'Profile' },
] as { href: string; icon: typeof Home; label: string; isAI?: boolean }[];

const recentChats = [
  { id: '1', title: 'Introduction to Machine Learning fundamentals' },
  { id: '2', title: 'React hooks deep dive and patterns' },
  { id: '3', title: 'Building REST APIs with Node.js' },
];

/* ============================================================
   Sidebar Component
   ============================================================ */
export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);

  // The classroom owns a focused, distraction-free layout of its own —
  // global nav chrome (search, notifications, course browsing) has no
  // place alongside an active lesson. Hidden here, not in the shared
  // layout, so this stays a single-file opt-out per shell piece.
  if (pathname.startsWith('/classroom')) {
    return null;
  }

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 240 }}
      transition={{ type: 'spring', stiffness: 400, damping: 40 }}
      className={cn(
        'hidden md:flex flex-col h-screen bg-[#0d0f18]/60 backdrop-blur-2xl border-r border-white/[0.06]',
        'overflow-hidden shrink-0 relative z-20',
      )}
    >
      {/* ---- Logo ---- */}
      <div className="flex items-center justify-between px-4 py-5 shrink-0">
        <AnimatePresence mode="wait">
          {!collapsed ? (
            <motion.div
              key="logo-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col leading-none"
            >
              <span className="text-xl font-black bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] bg-clip-text text-transparent">
                LYO
              </span>
              <span className="text-[10px] font-semibold text-[var(--text-secondary)] tracking-wider uppercase">
                Da ONE
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="logo-icon"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center shadow-lg shadow-[#6366f1]/20"
            >
              <span className="text-white text-xs font-black">L</span>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            'p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            'hover:bg-white/5 transition-colors',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* ---- Nav Items ---- */}
      <nav className="flex flex-col gap-0.5 px-2 flex-1 overflow-y-auto no-scrollbar">
        {navItems.map(({ href, icon: Icon, label, isAI }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1]/60',
                isActive
                  ? 'bg-[#6366f1]/10 text-[#a78bfa] border-l-2 border-[#6366f1] pl-[10px]'
                  : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]',
                isAI && !isActive && 'hover:text-[#a78bfa]',
              )}
              title={collapsed ? label : undefined}
            >
              <span className={cn('shrink-0', isAI && 'relative')}>
                {isAI && !collapsed ? (
                  <span className="relative">
                    <span className="absolute inset-0 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] opacity-20 blur-[2px]" />
                    <Icon
                      className={cn(
                        'w-5 h-5 relative',
                        isActive ? 'text-[#a78bfa]' : 'text-[var(--text-secondary)] group-hover:text-[#a78bfa]',
                      )}
                    />
                  </span>
                ) : (
                  <Icon className="w-5 h-5" />
                )}
              </span>

              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      'text-sm font-medium whitespace-nowrap overflow-hidden',
                      isAI && 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] bg-clip-text',
                      isAI ? 'text-transparent' : '',
                    )}
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}

        {/* ---- Recent Chats ---- */}
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-4 pt-4 border-t border-[var(--border)]"
          >
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Recent Chats
            </p>
            {recentChats.map((chat) => (
              <Link
                key={chat.id}
                href={`/chat?id=${chat.id}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors group"
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                <span className="text-xs truncate">{chat.title}</span>
              </Link>
            ))}
          </motion.div>
        )}
      </nav>

      {/* ---- Bottom: User + Settings ---- */}
      <div className="px-2 py-3 border-t border-[var(--border)] shrink-0">
        <div
          className={cn(
            'flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer',
            collapsed && 'justify-center',
          )}
        >
          <Avatar name={user?.displayName ?? 'User'} size="sm" online={true} className="shrink-0" />

          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="flex-1 min-w-0 overflow-hidden"
              >
                <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                  {user?.displayName ?? 'User'}
                </p>
                <p className="text-[10px] text-[var(--text-secondary)] truncate">
                  Level {user?.level ?? 1} · {(user?.xp ?? 0).toLocaleString()} XP
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Link
                  href="/settings"
                  className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
                  aria-label="Settings"
                >
                  <Settings className="w-4 h-4" />
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.aside>
  );
}

export default Sidebar;
