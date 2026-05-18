import { useCallback, useEffect, useState } from "react";
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
  const [featuredCharacterCards, setFeaturedCharacterCards] = useState<Set<string>>(
    () => new Set(featuredCharacterCardKeys),
  );

  useEffect(() => {
    setFeaturedCharacterCards(new Set(featuredCharacterCardKeys));
  }, [featuredCharacterCardKeys]);

  const persistFeaturedCharacterCards = useCallback(
    (next: Set<string>) => {
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
      const next = new Set(featuredCharacterCards);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      persistFeaturedCharacterCards(next);
    },
    [featuredCharacterCards, persistFeaturedCharacterCards],
  );

  const removeFeaturedCharacterCard = useCallback(
    (key: string) => {
      if (!featuredCharacterCards.has(key)) return;
      const next = new Set(featuredCharacterCards);
      next.delete(key);
      persistFeaturedCharacterCards(next);
    },
    [featuredCharacterCards, persistFeaturedCharacterCards],
  );

  return {
    featuredCharacterCards,
    removeFeaturedCharacterCard,
    toggleFeaturedCharacterCard,
  };
}
