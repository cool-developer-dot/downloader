import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { IconButton } from '@/components/buttons/IconButton';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { SearchField } from '@/components/inputs/SearchField';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { pendingNavigationService } from '@/browser/services';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import {
  bookmarkOrganizerRepository,
  type BookmarkFolder,
  type OrganizedBookmark,
} from '@/storage/repositories';
import { useBookmarksStore } from '@/store/bookmarks';
import { BookmarkDeleteDialog } from '@/screens/bookmarks/components';

import {
  addToHomeScreen,
  bookmarkChanges,
  bookmarkEditRequests,
  change,
  exportBookmarks,
  importBookmarks,
} from './bookmarks.service';
import { BookmarkRow, bookmarkRowHeight, FolderRow } from './components/BookmarkRows';
import { BookmarkEditHost, FolderNameSheet, FolderPickerSheet } from './components/BookmarkSheets';
import { LinkCheckSheet } from './components/LinkCheckSheet';
import { ReadingListView } from './components/ReadingListView';
import { SortableRows } from './components/SortableRows';
import { openReadingListUri } from '@/browser/capture/offline-pages.service';

type Row = { id: string; kind: 'folder'; folder: BookmarkFolder } | { id: string; kind: 'bookmark'; bookmark: OrganizedBookmark };

function openInBrowser(url: string): void {
  pendingNavigationService.set(url, { targetTabId: useBrowserStore.getState().activeTabId });
  navigation.navigate(routePaths.browser);
}

function openInNewTab(url: string): void {
  const result = useBrowserStore.getState().createTab({ url });
  if (result.status === 'LIMIT_REACHED') {
    announceTabsLimitReached();
    return;
  }
  navigation.navigate(routePaths.browser);
}

/**
 * B9 — Bookmarks (route `/bookmarks`): folders with breadcrumbs (#77), Edit (#78), drag / Move up / Move down (#80),
 * tags and notes in search with tag chips (#92 / #93), import / export (#84 / #85), Check links (#91), Add to home
 * screen (#87), and the reading list (#89) in its own tab.
 */
export const BookmarkManagerScreen = memo(function BookmarkManagerScreen() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const version = useSyncExternalStore(bookmarkChanges.subscribe, bookmarkChanges.getVersion, bookmarkChanges.getVersion);
  const [tab, setTab] = useState<'bookmarks' | 'reading'>('bookmarks');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [path, setPath] = useState<BookmarkFolder[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [options, setOptions] = useState<Row | null>(null);
  const [nameSheet, setNameSheet] = useState<{ mode: 'new' | 'rename'; folder?: BookmarkFolder } | null>(null);
  const [moving, setMoving] = useState<Row | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<{ folder: BookmarkFolder; bookmarks: number; folders: number } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  // As the previous Bookmarks screen: a confirmation before deleting one bookmark, and Clear all.
  const [confirmDelete, setConfirmDelete] = useState<OrganizedBookmark | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const searching = query.trim().length > 0 || tag != null;
  const rowHeight = bookmarkRowHeight();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [list, crumbs, allTags] = await Promise.all([
        searching
          ? bookmarkOrganizerRepository.search(query, tag).then((found) => ({ folders: [] as BookmarkFolder[], bookmarks: found }))
          : bookmarkOrganizerRepository.listFolder(folderId),
        bookmarkOrganizerRepository.folderPath(folderId),
        bookmarkOrganizerRepository.listTags(),
      ]);
      if (cancelled) return;
      setRows([
        ...list.folders.map((folder): Row => ({ id: `f:${folder.id}`, kind: 'folder', folder })),
        ...list.bookmarks.map((bookmark): Row => ({ id: `b:${bookmark.id}`, kind: 'bookmark', bookmark })),
      ]);
      setPath(crumbs);
      setTags(allTags);
    };
    void load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [folderId, query, searching, tag, version]);

  const folderCount = rows.filter((r) => r.kind === 'folder').length;

  const saveOrder = useCallback(
    (next: Row[]) => {
      const folders = next.filter((r): r is Extract<Row, { kind: 'folder' }> => r.kind === 'folder').map((r) => r.folder.id);
      const bookmarks = next.filter((r): r is Extract<Row, { kind: 'bookmark' }> => r.kind === 'bookmark').map((r) => r.bookmark.id);
      setRows(next);
      void change(async () => {
        await bookmarkOrganizerRepository.setOrder(folderId, 'folders', folders);
        await bookmarkOrganizerRepository.setOrder(folderId, 'bookmarks', bookmarks);
      });
    },
    [folderId],
  );

  const moveTo = useCallback(
    (id: string, toIndex: number) => {
      const from = rows.findIndex((r) => r.id === id);
      if (from < 0 || from === toIndex) return;
      const next = [...rows];
      const [item] = next.splice(from, 1);
      next.splice(toIndex, 0, item);
      saveOrder(next);
    },
    [rows, saveOrder],
  );

  const moveBy = useCallback(
    (row: Row, delta: -1 | 1) => {
      const index = rows.findIndex((r) => r.id === row.id);
      const target = index + delta;
      const [min, max] = row.kind === 'folder' ? [0, folderCount - 1] : [folderCount, rows.length - 1];
      if (index < 0 || target < min || target > max) return;
      moveTo(row.id, target);
    },
    [folderCount, moveTo, rows],
  );

  const openRow = useCallback((row: Row) => {
    if (row.kind === 'folder') {
      setFolderId(row.folder.id);
      setQuery('');
      setTag(null);
    } else {
      openInBrowser(row.bookmark.url);
    }
  }, []);

  const requestDeleteFolder = useCallback(async (folder: BookmarkFolder) => {
    const counts = await bookmarkOrganizerRepository.countInFolder(folder.id);
    setDeletingFolder({ folder, ...counts });
  }, []);

  const optionActions = useMemo((): ActionSheetItem[] => {
    if (!options) return [];
    const index = rows.findIndex((r) => r.id === options.id);
    const [min, max] = options.kind === 'folder' ? [0, folderCount - 1] : [folderCount, rows.length - 1];
    const list: ActionSheetItem[] = [];
    if (options.kind === 'bookmark') {
      const b = options.bookmark;
      list.push(
        { id: 'open', label: t('browserBookmarks.open'), icon: 'open-in-app', onPress: () => openInBrowser(b.url) },
        { id: 'open_tab', label: t('browserBookmarks.openNewTab'), icon: 'tab-plus', onPress: () => openInNewTab(b.url) },
        { id: 'edit', label: t('browserBookmarks.edit'), icon: 'pencil-outline', onPress: () => bookmarkEditRequests.open(b.id) },
        { id: 'move', label: t('browserBookmarks.moveTo'), icon: 'folder-move-outline', onPress: () => setMoving(options) },
      );
    } else {
      const f = options.folder;
      list.push(
        { id: 'open', label: t('browserBookmarks.open'), icon: 'folder-open-outline', onPress: () => openRow(options) },
        { id: 'rename', label: t('browserBookmarks.rename'), icon: 'pencil-outline', onPress: () => setNameSheet({ mode: 'rename', folder: f }) },
        { id: 'move', label: t('browserBookmarks.moveTo'), icon: 'folder-move-outline', onPress: () => setMoving(options) },
      );
    }
    if (!searching && index > min) list.push({ id: 'up', label: t('browserBookmarks.moveUp'), icon: 'arrow-up', onPress: () => moveBy(options, -1) });
    if (!searching && index >= 0 && index < max) {
      list.push({ id: 'down', label: t('browserBookmarks.moveDown'), icon: 'arrow-down', onPress: () => moveBy(options, 1) });
    }
    if (options.kind === 'bookmark') {
      const b = options.bookmark;
      list.push(
        { id: 'home', label: t('browserBookmarks.addToHome'), icon: 'cellphone-arrow-down', onPress: () => void addToHomeScreen(b.url, b.title) },
        {
          id: 'delete',
          label: t('browserBookmarks.delete'),
          icon: 'delete-outline',
          destructive: true,
          onPress: () => setConfirmDelete(b),
        },
      );
    } else {
      const f = options.folder;
      list.push({
        id: 'delete',
        label: t('browserBookmarks.delete'),
        icon: 'delete-outline',
        destructive: true,
        onPress: () => void requestDeleteFolder(f),
      });
    }
    return list;
  }, [folderCount, moveBy, openRow, options, requestDeleteFolder, rows, searching, t]);

  const menuActions = useMemo(
    (): ActionSheetItem[] => [
      { id: 'new_folder', label: t('browserBookmarks.newFolder'), icon: 'folder-plus-outline', onPress: () => setNameSheet({ mode: 'new' }) },
      {
        id: 'import',
        label: t('browserBookmarks.importBookmarks'),
        icon: 'import',
        onPress: () => {
          void importBookmarks((done, total) => setImportProgress({ done, total })).finally(() => setImportProgress(null));
        },
      },
      { id: 'export', label: t('browserBookmarks.exportBookmarks'), icon: 'export', onPress: () => void exportBookmarks() },
      { id: 'check', label: t('browserBookmarks.checkLinks'), icon: 'link-variant', onPress: () => setChecking(true) },
      { id: 'clear_all', label: t('bookmarks.clearAllA11y'), icon: 'delete-sweep-outline', destructive: true, onPress: () => setConfirmClear(true) },
    ],
    [t],
  );

  const deleteFolderActions = useMemo((): ActionSheetItem[] => {
    if (!deletingFolder) return [];
    const id = deletingFolder.folder.id;
    const after = () => {
      if (path.some((f) => f.id === id)) setFolderId(deletingFolder.folder.parentId);
    };
    return [
      {
        id: 'move_up',
        label: t('browserBookmarks.deleteFolderMoveUp'),
        icon: 'folder-move-outline',
        onPress: () => void change(() => bookmarkOrganizerRepository.deleteFolder(id, 'moveUp'), t('browserBookmarks.deleted')).then(after),
      },
      {
        id: 'delete_all',
        label: t('browserBookmarks.deleteFolderAll'),
        icon: 'delete-outline',
        destructive: true,
        onPress: () => void change(() => bookmarkOrganizerRepository.deleteFolder(id, 'deleteAll'), t('browserBookmarks.deleted')).then(after),
      },
    ];
  }, [deletingFolder, path, t]);

  const renderRow = useCallback(
    (row: Row, index: number) => {
      const [min, max] = row.kind === 'folder' ? [0, folderCount - 1] : [folderCount, rows.length - 1];
      const move = {
        canMoveUp: !searching && index > min,
        canMoveDown: !searching && index < max,
        onMoveBy: (delta: -1 | 1) => moveBy(row, delta),
        onOptions: () => setOptions(row),
      };
      return row.kind === 'folder' ? (
        <FolderRow folder={row.folder} onOpen={() => openRow(row)} {...move} />
      ) : (
        <BookmarkRow bookmark={row.bookmark} onOpen={() => openRow(row)} {...move} />
      );
    },
    [folderCount, moveBy, openRow, rows.length, searching],
  );

  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: t('browserBookmarks.root') }, ...path.map((f) => ({ id: f.id, name: f.name }))];

  return (
    <SafeAreaScreen testID="bookmark-manager" padded={false} edges={['top', 'left', 'right', 'bottom']} style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader
        title={t('browserBookmarks.title')}
        showBack
        onBackPress={() => navigation.back()}
        actions={
          tab === 'bookmarks' ? (
            <IconButton
              icon="dots-vertical"
              variant="ghost"
              color="headerIcon"
              accessibilityLabel={t('browserBookmarks.menu')}
              onPress={() => setMenuOpen(true)}
              testID="bookmark-manager-menu"
            />
          ) : null
        }
      />
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <SegmentedControl
          options={[
            { value: 'bookmarks', label: t('browserBookmarks.tabBookmarks') },
            { value: 'reading', label: t('browserBookmarks.tabReading') },
          ]}
          value={tab}
          onChange={setTab}
          testID="bookmark-manager-tabs"
        />
      </View>
      {tab === 'reading' ? (
        <ReadingListView
          // B17 #178: a row with an offline copy opens it read-only (the page online when the copy is gone).
          onOpen={(uri) => void openReadingListUri(uri, openInBrowser)}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder={t('browserBookmarks.searchPlaceholder')}
              testID="bookmark-manager-search"
            />
            {tags.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: rtl.rowDirection }}>
                {[{ tag: null as string | null, count: 0 }, ...tags].map((chip) => {
                  const selected = chip.tag === tag;
                  const label = chip.tag ?? t('browserBookmarks.allTags');
                  return (
                    <Pressable
                      key={chip.tag ?? '__all'}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={chip.tag ? t('browserBookmarks.tagA11y', { tag: chip.tag }) : label}
                      onPress={() => setTag(chip.tag)}
                      testID={`bookmark-tag-${chip.tag ?? 'all'}`}
                      style={{
                        minHeight: 48,
                        justifyContent: 'center',
                        paddingHorizontal: 14,
                        borderRadius: 24,
                        borderWidth: 1,
                        borderColor: selected ? theme.colors.primary : theme.colors.border,
                        backgroundColor: selected ? theme.colors.primary : 'transparent',
                      }}>
                      <Text variant="label" color={selected ? 'textOnPrimary' : 'textPrimary'}>
                        {chip.tag ? `#${label}` : label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            {!searching ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: rtl.rowDirection, alignItems: 'center' }}>
                {crumbs.map((crumb, index) => (
                  <View key={crumb.id ?? 'root'} style={{ flexDirection: rtl.rowDirection, alignItems: 'center' }}>
                    {index > 0 ? <Text color="textSecondary">{rtl.isRtl ? ' ‹ ' : ' › '}</Text> : null}
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={t('browserBookmarks.breadcrumbA11y', { name: crumb.name })}
                      accessibilityState={{ selected: index === crumbs.length - 1 }}
                      onPress={() => setFolderId(crumb.id)}
                      testID={`bookmark-crumb-${crumb.id ?? 'root'}`}
                      style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 }}>
                      <Text variant="label" color={index === crumbs.length - 1 ? 'textPrimary' : 'primary'}>
                        {crumb.name}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            {importProgress ? (
              <Text variant="caption" accessibilityLiveRegion="polite">
                {t('browserBookmarks.importing', importProgress)}
              </Text>
            ) : null}
          </View>
          {rows.length === 0 ? (
            <Text variant="body" color="textSecondary" style={{ padding: 24, textAlign: 'center' }}>
              {searching ? t('browserBookmarks.emptySearch') : t('browserBookmarks.empty')}
            </Text>
          ) : (
            <SortableRows
              items={rows}
              rowHeight={rowHeight}
              dragEnabled={!searching}
              range={(row) => (row.kind === 'folder' ? [0, Math.max(0, folderCount - 1)] : [folderCount, rows.length - 1])}
              renderRow={renderRow}
              onMove={moveTo}
              onHold={(id) => setOptions(rows.find((r) => r.id === id) ?? null)}
              testID="bookmark-manager-list"
            />
          )}
        </View>
      )}

      <ActionSheetModal visible={menuOpen} actions={menuActions} title={t('browserBookmarks.menu')} onClose={() => setMenuOpen(false)} />
      <ActionSheetModal
        visible={options != null}
        actions={optionActions}
        title={options ? (options.kind === 'folder' ? options.folder.name : options.bookmark.title) : undefined}
        onClose={() => setOptions(null)}
      />
      <ActionSheetModal
        visible={deletingFolder != null}
        actions={deleteFolderActions}
        title={deletingFolder ? t('browserBookmarks.deleteFolderTitle', { name: deletingFolder.folder.name }) : undefined}
        subtitle={
          deletingFolder
            ? t('browserBookmarks.deleteFolderMessage', { bookmarks: deletingFolder.bookmarks, folders: deletingFolder.folders })
            : undefined
        }
        onClose={() => setDeletingFolder(null)}
      />
      <FolderNameSheet
        visible={nameSheet != null}
        title={nameSheet?.mode === 'rename' ? t('browserBookmarks.rename') : t('browserBookmarks.newFolder')}
        initial={nameSheet?.folder?.name ?? ''}
        onSave={(name) => {
          if (nameSheet?.mode === 'rename' && nameSheet.folder) {
            const id = nameSheet.folder.id;
            void change(() => bookmarkOrganizerRepository.renameFolder(id, name));
          } else {
            void change(() => bookmarkOrganizerRepository.createFolder(folderId, name));
          }
        }}
        onClose={() => setNameSheet(null)}
      />
      <FolderPickerSheet
        visible={moving != null}
        selected={moving ? (moving.kind === 'folder' ? moving.folder.parentId : moving.bookmark.folderId) : null}
        exclude={moving?.kind === 'folder' ? moving.folder.id : null}
        onPick={(target) => {
          if (!moving) return;
          if (moving.kind === 'folder') void change(() => bookmarkOrganizerRepository.moveFolder(moving.folder.id, target));
          else void change(() => bookmarkOrganizerRepository.moveBookmark(moving.bookmark.id, target));
        }}
        onClose={() => setMoving(null)}
      />
      <LinkCheckSheet visible={checking} onClose={() => setChecking(false)} />
      <BookmarkDeleteDialog
        mode="delete"
        visible={confirmDelete != null}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void change(() => useBookmarksStore.getState().remove(target.id), t('browserBookmarks.deleted'));
        }}
        onCancel={() => setConfirmDelete(null)}
      />
      <BookmarkDeleteDialog
        mode="clear"
        visible={confirmClear}
        onConfirm={() => {
          setConfirmClear(false);
          void change(() => useBookmarksStore.getState().clear(), t('browserBookmarks.deleted'));
        }}
        onCancel={() => setConfirmClear(false)}
      />
      <BookmarkEditHost />
    </SafeAreaScreen>
  );
});
