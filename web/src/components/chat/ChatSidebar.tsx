'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import { cn, truncate } from '@/lib/utils';
import { useChatStore } from '@/stores/chat-store';
import type { ChatConversation } from '@/types';

// ─── Date grouping ────────────────────────────────────────────────────────────
type Group = 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Older';

function getGroup(dateStr: string): Group {
  const now = new Date();
  const date = new Date(dateStr);
  const diffDays = Math.floor(
    (now.setHours(0, 0, 0, 0) - date.setHours(0, 0, 0, 0)) / 86400000
  );
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Previous 7 Days';
  return 'Older';
}

function groupConversations(
  convos: ChatConversation[]
): { label: Group; items: ChatConversation[] }[] {
  const order: Group[] = ['Today', 'Yesterday', 'Previous 7 Days', 'Older'];
  const map = new Map<Group, ChatConversation[]>(order.map((g) => [g, []]));

  for (const c of convos) {
    map.get(getGroup(c.updatedAt))!.push(c);
  }

  return order
    .filter((g) => map.get(g)!.length > 0)
    .map((g) => ({ label: g, items: map.get(g)! }));
}

// ─── Single conversation row ──────────────────────────────────────────────────
function ConvoRow({
  convo,
  isActive,
  onSelect,
  onDelete,
}: {
  convo: ChatConversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const title =
    convo.title && convo.title !== 'New Chat'
      ? truncate(convo.title, 36)
      : convo.messages[0]
      ? truncate(convo.messages[0].content, 36)
      : 'New Chat';

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'group relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left',
        'transition-all duration-150',
        isActive
          ? 'bg-lyo-600/20 border border-lyo-500/30 text-white'
          : 'text-white/60 hover:bg-white/5 hover:text-white border border-transparent'
      )}
    >
      <MessageSquare
        className={cn(
          'w-4 h-4 shrink-0 transition-colors',
          isActive ? 'text-lyo-400' : 'text-white/30 group-hover:text-white/50'
        )}
      />
      <span className="flex-1 text-sm truncate">{title}</span>
      <AnimatePresence>
        {hovered && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.12 }}
            onClick={onDelete}
            className="p-1 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
            title="Delete conversation"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </button>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
interface ChatSidebarProps {
  className?: string;
}

export default function ChatSidebar({ className }: ChatSidebarProps) {
  const {
    conversations,
    activeConversationId,
    createConversation,
    loadConversation,
    deleteConversation,
  } = useChatStore();

  const groups = groupConversations(conversations);

  const handleNew = () => {
    createConversation();
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteConversation(id);
  };

  return (
    <div
      className={cn(
        'flex flex-col h-full w-64 shrink-0',
        'bg-black/30 backdrop-blur-md border-r border-white/5',
        className
      )}
    >
      {/* Logo / header */}
      <div className="px-4 pt-5 pb-4 flex items-center gap-2.5 border-b border-white/5">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-lyo-500 to-accent-purple flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-white">LYO</span>
        </div>
        <span className="font-semibold text-white text-sm tracking-tight">LYO</span>
      </div>

      {/* New chat button */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={handleNew}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium
            bg-gradient-to-r from-lyo-600/30 to-accent-purple/20 border border-lyo-500/20 text-white/80
            hover:from-lyo-600/50 hover:to-accent-purple/30 hover:text-white hover:border-lyo-500/40
            active:scale-[0.98] transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {conversations.length === 0 && (
          <p className="text-center text-xs text-white/25 px-3 py-6">
            No conversations yet. Start chatting!
          </p>
        )}

        {groups.map(({ label, items }) => (
          <div key={label}>
            <p className="px-2 mb-1 text-[11px] font-semibold text-white/25 uppercase tracking-wider">
              {label}
            </p>
            <div className="space-y-0.5">
              {items.map((convo) => (
                <ConvoRow
                  key={convo.id}
                  convo={convo}
                  isActive={convo.id === activeConversationId}
                  onSelect={() => loadConversation(convo.id)}
                  onDelete={(e) => handleDelete(e, convo.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/5">
        <p className="text-[11px] text-white/20 text-center">
          Powered by LYO · All chats private
        </p>
      </div>
    </div>
  );
}
