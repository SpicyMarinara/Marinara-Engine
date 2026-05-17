import { useCallback, useEffect, useRef, useState } from "react";
import { useUpdateChatMetadata } from "../../../hooks/use-chats";
import { TRACKER_FEATURED_CHARACTER_META_KEY } from "../lib/tracker-panel.constants";

export function useFeaturedCharacterCards({
  activeChatId,
  featuredCharacterCardKeys,
}: {
  activeChatId: string | null;
  featuredCharacterCardKeys: Set<string>;
}) {
  const updateChatMetadata = useUpdateChatMetadata();
  const [featuredCharacterCards, setFeaturedCharacterCards] = useState<Set<string>>(() => new Set());
  const featuredCharacterCardsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    featuredCharacterCardsRef.current = featuredCharacterCardKeys;
    setFeaturedCharacterCards(featuredCharacterCardKeys);
  }, [activeChatId, featuredCharacterCardKeys]);

  const persistFeaturedCharacterCards = useCallback(
    (next: Set<string>) => {
      featuredCharacterCardsRef.current = next;
      setFeaturedCharacterCards(next);
      if (!activeChatId) return;
      updateChatMetadata.mutate({
        id: activeChatId,
        [TRACKER_FEATURED_CHARACTER_META_KEY]: Array.from(next),
      });
    },
    [activeChatId, updateChatMetadata],
  );

  const toggleFeaturedCharacterCard = useCallback(
    (key: string) => {
      const next = new Set(featuredCharacterCardsRef.current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      persistFeaturedCharacterCards(next);
    },
    [persistFeaturedCharacterCards],
  );

  const removeFeaturedCharacterCard = useCallback(
    (key: string) => {
      if (!featuredCharacterCardsRef.current.has(key)) return;
      const next = new Set(featuredCharacterCardsRef.current);
      next.delete(key);
      persistFeaturedCharacterCards(next);
    },
    [persistFeaturedCharacterCards],
  );

  return {
    featuredCharacterCards,
    removeFeaturedCharacterCard,
    toggleFeaturedCharacterCard,
  };
}
