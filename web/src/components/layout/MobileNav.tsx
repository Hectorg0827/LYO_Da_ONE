'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Target, Compass, Users, SquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import MascotAvatar from '@/components/chat/MascotAvatar';
import CreateSheet from '@/components/create/CreateSheet';
import { LYO_MASCOT_LAYOUT_ID } from '@/lib/motion-ids';

// Mirrors iOS LivingHubTabBar (MainTabView.swift): two icon groups flanking
// the center mascot FAB — target/Focus, compass/Discover · people/Community,
// plus/Create. Icon-only ghost tabs with a dot indicator, mascot floats in
// the middle with a breathing glow.
const leftItems = [
  { href: '/', icon: Target, label: 'Focus' },
  { href: '/discover', icon: Compass, label: 'Discover' },
];

const rightItems = [{ href: '/community', icon: Users, label: 'Community' }];

function GhostTab({
  href,
  icon: Icon,
  label,
  isActive,
}: {
  href: string;
  icon: typeof Target;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      key={href}
      href={href}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      className="flex flex-col items-center justify-center gap-1 px-4 py-2 transition-all duration-200"
    >
      <Icon
        className={cn(
          'w-6 h-6 text-white transition-all duration-200',
          isActive
            ? 'opacity-100 scale-110 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'
            : 'opacity-50',
        )}
      />
      <span
        className={cn(
          'w-1 h-1 rounded-full bg-white transition-opacity duration-200',
          isActive ? 'opacity-100' : 'opacity-0',
        )}
      />
    </Link>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const isChat = pathname.startsWith('/chat');
  const [createOpen, setCreateOpen] = useState(false);

  const isItemActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  // Focused classroom layout: the tab icons, search-adjacent chrome, and
  // Create button go away — but Lyo is the user's persistent companion who
  // "attends every class with them," so the main mascot FAB stays, just
  // without the bar it used to ride in.
  if (pathname.startsWith('/classroom')) {
    return (
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex justify-center pb-[calc(env(safe-area-inset-bottom)+10px)] pointer-events-none"
        aria-label="Lyo"
      >
        <Link
          href="/chat"
          aria-label="LYO"
          className="relative flex items-center justify-center pointer-events-auto"
        >
          <span className="absolute w-28 h-28 rounded-full mascot-fab-glow pointer-events-none" />
          <div
            className={cn(
              'relative w-[70px] h-[70px] rounded-full flex items-center justify-center',
              'animate-breathe transition-transform duration-200 active:scale-95',
              'drop-shadow-[0_5px_10px_rgba(167,139,250,0.6)]',
            )}
          >
            <motion.div
              layoutId={LYO_MASCOT_LAYOUT_ID}
              transition={{ layout: { type: 'spring', bounce: 0.35, duration: 0.6 } }}
              className="flex items-center justify-center"
            >
              <MascotAvatar idle size={64} />
            </motion.div>
          </div>
        </Link>
      </div>
    );
  }

  return (
    <nav
      className={cn(
        'md:hidden fixed bottom-0 left-0 right-0 z-50',
        'bg-[#0d0f18]/75 backdrop-blur-2xl',
        'border-t border-white/10',
        'pb-[env(safe-area-inset-bottom)]',
      )}
      aria-label="Mobile navigation"
    >
      <div className="flex items-center justify-between h-20 px-6">
        <div className="flex items-center gap-2">
          {leftItems.map((item) => (
            <GhostTab key={item.href} {...item} isActive={isItemActive(item.href)} />
          ))}
        </div>

        {/* Center mascot FAB — floats above the bar in a glow, breathing.
            Lyo "lives" here when not in chat and flies to the chat header
            on tap (shared layoutId). */}
        <Link
          href="/chat"
          aria-label="LYO"
          aria-current={isChat ? 'page' : undefined}
          className="relative flex items-center justify-center -mt-10"
        >
          <span className="absolute w-28 h-28 rounded-full mascot-fab-glow pointer-events-none" />
          <div
            className={cn(
              'relative w-[70px] h-[70px] rounded-full flex items-center justify-center',
              'animate-breathe transition-transform duration-200 active:scale-95',
              'drop-shadow-[0_5px_10px_rgba(167,139,250,0.6)]',
            )}
          >
            {!isChat && (
              <motion.div
                layoutId={LYO_MASCOT_LAYOUT_ID}
                transition={{ layout: { type: 'spring', bounce: 0.35, duration: 0.6 } }}
                className="flex items-center justify-center"
              >
                <MascotAvatar idle size={64} />
              </motion.div>
            )}
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {rightItems.map((item) => (
            <GhostTab key={item.href} {...item} isActive={isItemActive(item.href)} />
          ))}

          {/* Create — opens the creation sheet, mirroring the iOS plus tab */}
          <button
            onClick={() => setCreateOpen(true)}
            aria-label="Create"
            className="flex flex-col items-center justify-center gap-1 px-4 py-2 transition-all duration-200"
          >
            <SquarePlus
              className={cn(
                'w-6 h-6 text-white transition-all duration-200',
                createOpen
                  ? 'opacity-100 scale-110 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'
                  : 'opacity-50'
              )}
            />
            <span
              className={cn(
                'w-1 h-1 rounded-full bg-white transition-opacity duration-200',
                createOpen ? 'opacity-100' : 'opacity-0'
              )}
            />
          </button>
        </div>
      </div>

      <CreateSheet isOpen={createOpen} onClose={() => setCreateOpen(false)} />
    </nav>
  );
}

export default MobileNav;
