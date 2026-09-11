'use client';

import { Suspense, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import ChatInterface from '@/components/chat/ChatInterface';
import ChatSidebar from '@/components/chat/ChatSidebar';
import MascotAvatar from '@/components/chat/MascotAvatar';
import { LYO_MASCOT_LAYOUT_ID } from '@/lib/motion-ids';

export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      {/* Ambient gradient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-lyo-600/10 blur-3xl" />
        <div className="absolute top-1/3 -right-20 w-[400px] h-[400px] rounded-full bg-accent-purple/10 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 w-[350px] h-[350px] rounded-full bg-accent-pink/8 blur-3xl" />
      </div>

      {/* ── Desktop sidebar ───────────────────────────────────── */}
      <div className="hidden md:flex">
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              key="sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 256, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="relative overflow-hidden shrink-0 h-full"
            >
              <ChatSidebar className="h-full" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Mobile drawer overlay ─────────────────────────────── */}
      <AnimatePresence>
        {mobileDrawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
              onClick={() => setMobileDrawerOpen(false)}
            />
            {/* Drawer */}
            <motion.div
              key="drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-72"
            >
              <ChatSidebar className="h-full" />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="relative flex-1 flex flex-col min-w-0 h-full">
        {/* Top bar */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-black/10 backdrop-blur-md">
          {/* Desktop sidebar toggle */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="hidden md:flex p-2 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-all duration-200"
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileDrawerOpen(true)}
            className="md:hidden p-2 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-all duration-200"
            title="Open sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>

          {/* Title */}
          <div className="flex items-center gap-2">
            {/* Lands here after flying in from the nav button (shared layoutId) */}
            <motion.div
              layoutId={LYO_MASCOT_LAYOUT_ID}
              transition={{ layout: { type: 'spring', bounce: 0.35, duration: 0.6 } }}
              className="shrink-0"
            >
              <MascotAvatar idle size={28} />
            </motion.div>
            <span className="text-sm font-semibold text-white/80 tracking-tight">
              Lyo
            </span>
            {/* Live indicator */}
            <span className="flex items-center gap-1 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[11px] text-green-400/70 font-medium">online</span>
            </span>
          </div>
        </div>

        {/* Chat interface — bottom padding clears the fixed mobile tab bar */}
        <div className={cn('flex-1 min-h-0 pb-20 md:pb-0')}>
          {/* ChatInterface reads `?prompt=` to accept a seeded opening turn
              (Home's "I have a test" entry), so it needs a Suspense boundary
              for the same reason ClassroomPage does. */}
          <Suspense fallback={<div className="h-full" />}>
            <ChatInterface />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
