import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { canAttemptPlayback, type MediaLibraryItem } from '@/library';
import { useTranslation } from '@/localization';
import { describeMediaForPlaylist, libraryItemToInput } from '@/playlists/playlist-library';
import type { PlaylistItemInput } from '@/storage/repositories/playlists.repository';

/**
 * P7 #617 in the Library: the long-press menu's "Add to playlist" and "Select", the selection mode (tapping videos
 * selects them; Android Back or Cancel leaves it), and the add sheet's videos. Selected videos are added in the order
 * the Library shows them.
 */
export function useLibraryPlaylists(visibleItems: readonly MediaLibraryItem[]) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const [sheetInputs, setSheetInputs] = useState<readonly PlaylistItemInput[] | null>(null);
  const selecting = selected != null;

  const byId = useMemo(() => new Map(visibleItems.map((item) => [item.id, item] as const)), [visibleItems]);

  const toggle = useCallback((id: string) => {
    setSelected((previous) => {
      if (!previous) return previous;
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const cancel = useCallback(() => setSelected(null), []);

  // Back leaves the selection first (the screen stays) — only while the Library is the screen in front: the tabs
  // stay mounted, and Back on another tab must not end a selection it can't see.
  useFocusEffect(
    useCallback(() => {
      if (!selecting) {
        return;
      }
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setSelected(null);
        return true;
      });
      return () => subscription.remove();
    }, [selecting]),
  );

  const openSheetFor = useCallback(
    (id: string) => {
      const item = byId.get(id);
      if (item) {
        setSheetInputs([libraryItemToInput(item)]);
        return;
      }
      void describeMediaForPlaylist(id, null).then((input) => setSheetInputs([input]));
    },
    [byId],
  );

  /** The long-press menu's two rows (one spread line in the Library's menu, like the tag action). */
  const actionsFor = useCallback(
    (id: string, close: () => void): ActionSheetItem[] => [
      {
        id: 'add-to-playlist',
        label: t('playlists.addToPlaylist'),
        icon: 'playlist-plus',
        onPress: () => {
          close();
          openSheetFor(id);
        },
      },
      {
        id: 'select',
        label: t('playlists.select'),
        icon: 'checkbox-multiple-marked-outline',
        onPress: () => {
          close();
          // Starts with this video, unless its file is missing (a missing card can't be tapped to unselect it).
          const item = byId.get(id);
          setSelected(new Set(item && canAttemptPlayback(item.localAvailability) ? [id] : []));
        },
      },
    ],
    [byId, openSheetFor, t],
  );

  const selectedItems = useMemo(
    () => (selected ? visibleItems.filter((item) => selected.has(item.id)) : []),
    [selected, visibleItems],
  );

  const closeSheet = useCallback(() => setSheetInputs(null), []);

  const addSelected = useCallback(() => {
    if (selectedItems.length > 0) {
      setSheetInputs(selectedItems.map(libraryItemToInput));
    }
  }, [selectedItems]);

  return {
    actionsFor,
    /** The selected ids while selecting; undefined otherwise (what `LibraryList` takes). */
    selectedIds: selected ?? undefined,
    selecting,
    selectedCount: selectedItems.length,
    toggle,
    cancel,
    addSelected,
    sheetInputs,
    closeSheet,
    /** After adding a selection: leave the selection mode. */
    onAdded: cancel,
  };
}
