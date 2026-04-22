// ──────────────────────────────────────────────
// Floating avatar notification bubbles
// ──────────────────────────────────────────────
// When a character messages in another conversation, their avatar appears
// as a floating circle on the right edge of the main content area.
// Click → navigate to that conversation. X → dismiss.
// On mobile, multiple notifications collapse into a single tappable group.

import { useState } from "react";
import { X, MessageCircle } from "lucide-react";
import { useChatStore } from "../../stores/chat.store";
import { useGameModeStore } from "../../stores/game-mode.store";
import { useUIStore } from "../../stores/ui.store";
import { cn } from "../../lib/utils";
import { AnimatePresence, motion } from "framer-motion";

export function ChatNotificationBubbles() {
  const chatNotifications = useChatStore((s) => s.chatNotifications);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const dismissNotification = useChatStore((s) => s.dismissNotification);
  const setShouldOpenSettings = useChatStore((s) => s.setShouldOpenSettings);
  const setShouldOpenWizard = useChatStore((s) => s.setShouldOpenWizard);
  const setShouldOpenWizardInShortcutMode = useChatStore((s) => s.setShouldOpenWizardInShortcutMode);
  const setPendingNewChatMode = useChatStore((s) => s.setPendingNewChatMode);
  const setSetupActive = useGameModeStore((s) => s.setSetupActive);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  /** Navigate to a chat — close any editor/detail view first so ChatArea is visible. */
  const navigateToChat = (chatId: string) => {
    closeAllDetails();
    setPendingNewChatMode(null);
    setShouldOpenSettings(false);
    setShouldOpenWizard(false);
    setShouldOpenWizardInShortcutMode(false);
    setSetupActive(false);
    setActiveChatId(chatId);
  };

  const notifications = Array.from(chatNotifications.values());

  if (notifications.length === 0) return null;

  const totalCount = notifications.reduce((sum, n) => sum + n.count, 0);

  return (
    <div className="pointer-events-none absolute right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-end gap-3">
      {/* ── Desktop: always show all bubbles ── */}
      <div className="hidden md:flex md:flex-col md:gap-3">
        <AnimatePresence mode="popLayout">
          {notifications.map((notif) => (
            <NotificationBubble
              key={notif.chatId}
              notif={notif}
              onNavigate={() => navigateToChat(notif.chatId)}
              onDismiss={() => dismissNotification(notif.chatId)}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* ── Mobile: collapsed or expanded ── */}
      <div className="flex flex-col items-end gap-2 md:hidden">
        <AnimatePresence mode="popLayout">
          {notifications.length === 1 || mobileExpanded ? (
            /* Show all individual bubbles */
            notifications.map((notif) => (
              <NotificationBubble
                key={notif.chatId}
                notif={notif}
                onNavigate={() => {
                  navigateToChat(notif.chatId);
                  setMobileExpanded(false);
                }}
                onDismiss={() => {
                  dismissNotification(notif.chatId);
                  if (notifications.length <= 2) setMobileExpanded(false);
                }}
              />
            ))
          ) : (
            /* Collapsed: stacked avatar preview → tap to expand */
            <motion.button
              key="collapsed-group"
              initial={{ x: 60, opacity: 0, scale: 0.8 }}
              animate={{ x: 0, opacity: 1, scale: 1 }}
              exit={{ x: 60, opacity: 0, scale: 0.8 }}
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
              className="pointer-events-auto relative h-12 w-12"
              onClick={() => setMobileExpanded(true)}
              title={`${notifications.length} conversations`}
            >
              {/* Stacked circles (max 3 visible) */}
              {notifications.slice(0, 3).map((notif, i) => (
                <div
                  key={notif.chatId}
                  className={cn(
                    "absolute flex h-10 w-10 items-center justify-center overflow-hidden rounded-full",
                    "bg-[var(--accent)]/20 ring-2 ring-[var(--background)]",
                  )}
                  style={{
                    top: i * 5,
                    right: i * 5,
                    zIndex: 3 - i,
                  }}
                >
                  {notif.avatarUrl ? (
                    <img src={notif.avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <MessageCircle className="h-4 w-4 text-[var(--accent)]" />
                  )}
                </div>
              ))}
              {/* Combined badge */}
              <span
                className={cn(
                  "absolute -bottom-1 -right-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full px-1",
                  "bg-red-500 text-[10px] font-bold text-white shadow",
                )}
              >
                {totalCount > 99 ? "99+" : totalCount}
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Single notification bubble ──

function NotificationBubble({
  notif,
  onNavigate,
  onDismiss,
}: {
  notif: { chatId: string; characterName: string; avatarUrl: string | null; count: number };
  onNavigate: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      key={notif.chatId}
      initial={{ x: 60, opacity: 0, scale: 0.8 }}
      animate={{ x: 0, opacity: 1, scale: 1 }}
      exit={{ x: 60, opacity: 0, scale: 0.8 }}
      transition={{ type: "spring", damping: 20, stiffness: 300 }}
      className="pointer-events-auto group relative"
    >
      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className={cn(
          "absolute -left-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full",
          "bg-[var(--background)] text-[var(--foreground)]/60 shadow-md ring-1 ring-[var(--foreground)]/10",
          "transition-opacity hover:text-[var(--foreground)]",
          "opacity-0 group-hover:opacity-100 max-md:opacity-100",
        )}
      >
        <X className="h-3 w-3" />
      </button>

      {/* Avatar bubble */}
      <button
        onClick={onNavigate}
        className={cn(
          "relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full",
          "bg-[var(--accent)]/20 shadow-lg ring-2 ring-[var(--accent)]/40",
          "transition-transform hover:scale-110 active:scale-95",
        )}
        title={`${notif.characterName} sent a message`}
      >
        {notif.avatarUrl ? (
          <img src={notif.avatarUrl} alt={notif.characterName} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <MessageCircle className="h-5 w-5 text-[var(--accent)]" />
        )}
      </button>

      {/* Red unread badge */}
      <span
        className={cn(
          "absolute -bottom-0.5 -left-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1",
          "bg-red-500 text-[10px] font-bold text-white shadow",
        )}
      >
        {notif.count > 99 ? "99+" : notif.count}
      </span>
    </motion.div>
  );
}
