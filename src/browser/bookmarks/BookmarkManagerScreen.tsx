import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, View, type TextInput } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { pendingNavigationService } from '@/browser/services';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { isValidBrowserPageUrl } from '@/browser/utils';
import { DsChip, DsChipRow, DsHeader, DsRow, DsRowGroup, DsScreen, DsSearchField, DsSectionLabel, DsText, DsToggle, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { bookmarkOrganizerRepository, type BookmarkFolder, type OrganizedBookmark } from '@/storage/repositories';
import { useBookmarksStore } from '@/store/bookmarks';
import { useSettingsStore } from '@/store/settings';
import { BookmarkDeleteDialog } from '@/screens/bookmarks/components';
import { openReadingListUri } from '@/browser/capture/offline-pages.service';

import {
  addToHomeScreen,
  bookmarkAllTabs,
  bookmarkChanges,
  bookmarkEditRequests,
  change,
  exportBookmarks,
  importBookmarks,
  notify,
} from './bookmarks.service';
import { BookmarkRow, bookmarkRowHeight, FolderRow, IconTile, ListRow } from './components/BookmarkRows';
import { BookmarkEditHost, FolderNameSheet, FolderPickerSheet } from './components/BookmarkSheets';
import { LinkCheckSheet } from './components/LinkCheckSheet';
import { ReadingListView } from './components/ReadingListView';
import { SortableRows } from './components/SortableRows';

type Row = { id: string; kind: 'folder'; folder: BookmarkFolder } | { id: string; kind: 'bookmark'; bookmark: OrganizedBookmark };
type StaticKey = 'bar' | 'tags' | 'links';
type Item = Row | { id: string; kind: 'static'; key: StaticKey };

const STATIC_ROWS: Item[] = [
  { id: 'static:bar', kind: 'static', key: 'bar' },
  { id: 'static:tags', kind: 'static', key: 'tags' },
  { id: 'static:links', kind: 'static', key: 'links' },
];

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
 * Design 4 "Browser · Bookmarks" over B9's bookmark organizer: header "Bookmarks / N items" with a search button that
 * reveals the search field; chips Folders · Reading list · History · Notes; one card with the folders of the current
 * level (and its bookmarks), then — at the root — Bookmarks bar (toggle), Tags & notes and Broken link check; the
 * MANAGE card (Import / Export, Add to home screen, Bookmark all tabs). Inside a folder a breadcrumb line sits above
 * the card and rows can be dragged (SortableRows); long-press opens the row's actions (rename / move / delete, Move
 * up / Move down, Edit, Add to home screen…). Every B9 sheet and dialog is kept.
 */
export const BookmarkManagerScreen = memo(function BookmarkManagerScreen() {
  const theme = useTheme();
  const { t, tp, rtl } = useTranslation();
  const version = useSyncExternalStore(bookmarkChanges.subscribe, bookmarkChanges.getVersion, bookmarkChanges.getVersion);
  const total = useBookmarksStore((state) => state.total);
  const bookmarksInitialized = useBookmarksStore((state) => state.initialized);
  const bookmarksLoading = useBookmarksStore((state) => state.loading);
  const loadBookmarks = useBookmarksStore((state) => state.load);
  const bookmarksBar = useSettingsStore((state) => state.bookmarksBar === true);
  const updateSetting = useSettingsStore((state) => state.updateSetting);

  const [tab, setTab] = useState<'bookmarks' | 'reading'>('bookmarks');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [path, setPath] = useState<BookmarkFolder[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tagsMode, setTagsMode] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [options, setOptions] = useState<Row | null>(null);
  const [nameSheet, setNameSheet] = useState<{ mode: 'new' | 'rename'; folder?: BookmarkFolder } | null>(null);
  const [moving, setMoving] = useState<Row | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<{ folder: BookmarkFolder; bookmarks: number; folders: number } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<OrganizedBookmark | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const searchRef = useRef<TextInput>(null);

  const searching = query.trim().length > 0 || tag != null || tagsMode;
  const fieldVisible = searchOpen || tagsMode;
  const rowHeight = bookmarkRowHeight();

  // The header's "N items" is the bookmarks store's total (refreshed after every change by bookmarkChanges).
  useEffect(() => {
    if (!bookmarksInitialized && !bookmarksLoading) void loadBookmarks(1).catch(() => undefined);
  }, [bookmarksInitialized, bookmarksLoading, loadBookmarks]);

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
      const folderCounts = await Promise.all(
        list.folders.map((folder) => bookmarkOrganizerRepository.countInFolder(folder.id).then((c) => [folder.id, c.bookmarks + c.folders] as const)),
      );
      if (cancelled) return;
      setRows([
        ...list.folders.map((folder): Row => ({ id: `f:${folder.id}`, kind: 'folder', folder })),
        ...list.bookmarks.map((bookmark): Row => ({ id: `b:${bookmark.id}`, kind: 'bookmark', bookmark })),
      ]);
      setCounts(Object.fromEntries(folderCounts));
      setPath(crumbs);
      setTags(allTags);
    };
    void load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [folderId, query, searching, tag, version]);

  const folderCount = rows.filter((r) => r.kind === 'folder').length;
  const atRoot = folderId == null && !searching;
  const items: Item[] = useMemo(() => (atRoot ? [...rows, ...STATIC_ROWS] : rows), [atRoot, rows]);

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
      if (from < 0 || from === toIndex || toIndex >= rows.length) return;
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

  const goToFolder = useCallback((id: string | null) => {
    setFolderId(id);
    setQuery('');
    setTag(null);
    setTagsMode(false);
    setSearchOpen(false);
  }, []);

  const openRow = useCallback(
    (row: Row) => {
      if (row.kind === 'folder') goToFolder(row.folder.id);
      else openInBrowser(row.bookmark.url);
    },
    [goToFolder],
  );

  const requestDeleteFolder = useCallback(async (folder: BookmarkFolder) => {
    const counted = await bookmarkOrganizerRepository.countInFolder(folder.id);
    setDeletingFolder({ folder, ...counted });
  }, []);

  const openSearch = useCallback(() => {
    if (tab !== 'bookmarks') setTab('bookmarks');
    setSearchOpen(true);
    // Already open: the button puts the cursor back in the field.
    searchRef.current?.focus();
  }, [tab]);

  const closeSearch = useCallback(() => {
    setQuery('');
    setTag(null);
    setSearchOpen(false);
    setTagsMode(false);
  }, []);

  const enterTagsMode = useCallback(() => {
    setTagsMode(true);
    setQuery('');
    setTag(null);
  }, []);

  const addCurrentPageToHome = useCallback(() => {
    const state = useBrowserStore.getState();
    const active = state.tabs.find((candidate) => candidate.id === state.activeTabId);
    if (!active || !isValidBrowserPageUrl(active.url)) {
      notify(t('lightBookmarks.noCurrentPage'));
      return;
    }
    void addToHomeScreen(active.url, active.title || active.url);
  }, [t]);

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
        { id: 'delete', label: t('browserBookmarks.delete'), icon: 'delete-outline', destructive: true, onPress: () => setConfirmDelete(b) },
      );
    } else {
      const f = options.folder;
      list.push({ id: 'delete', label: t('browserBookmarks.delete'), icon: 'delete-outline', destructive: true, onPress: () => void requestDeleteFolder(f) });
    }
    return list;
  }, [folderCount, moveBy, openRow, options, requestDeleteFolder, rows, searching, t]);

  // The design's "Import / Export" row: the two pickers, plus New folder and Clear all (the frame has no row for them).
  const manageActions = useMemo(
    (): ActionSheetItem[] => [
      {
        id: 'import',
        label: t('browserBookmarks.importBookmarks'),
        icon: 'import',
        onPress: () => {
          void importBookmarks((done, all) => setImportProgress({ done, total: all })).finally(() => setImportProgress(null));
        },
      },
      { id: 'export', label: t('browserBookmarks.exportBookmarks'), icon: 'export', onPress: () => void exportBookmarks() },
      { id: 'new_folder', label: t('browserBookmarks.newFolder'), icon: 'folder-plus-outline', onPress: () => setNameSheet({ mode: 'new' }) },
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
    (item: Item, index: number) => {
      const divided = index > 0;
      if (item.kind === 'folder') {
        return (
          <FolderRow
            folder={item.folder}
            itemCount={counts[item.folder.id] ?? null}
            height={rowHeight}
            divided={divided}
            onOpen={() => openRow(item)}
            onOptions={() => setOptions(item)}
          />
        );
      }
      if (item.kind === 'bookmark') {
        return <BookmarkRow bookmark={item.bookmark} height={rowHeight} divided={divided} onOpen={() => openRow(item)} onOptions={() => setOptions(item)} />;
      }
      if (item.key === 'bar') {
        const toggle = () => updateSetting('bookmarksBar', !bookmarksBar);
        return (
          <ListRow
            leading={<IconTile icon="star" />}
            title={t('browserBookmarks.bookmarksBar')}
            subtitle={t('lightBookmarks.bookmarksBarShow')}
            height={rowHeight}
            divided={divided}
            onPress={toggle}
            accessibilityLabel={t('browserBookmarks.bookmarksBarSetting')}
            accessibilityHint={t('browserBookmarks.bookmarksBarHint')}
            trailing={<DsToggle value={bookmarksBar} onValueChange={toggle} accessibilityLabel={t('browserBookmarks.bookmarksBarSetting')} testID="bookmarks-bar-toggle" />}
            testID="bookmark-manager-bar"
          />
        );
      }
      if (item.key === 'tags') {
        return (
          <ListRow
            leading={<IconTile icon="tag" />}
            title={t('lightBookmarks.tagsNotes')}
            height={rowHeight}
            divided={divided}
            onPress={enterTagsMode}
            testID="bookmark-manager-tags"
          />
        );
      }
      return (
        <ListRow
          leading={<IconTile icon="link" />}
          title={t('lightBookmarks.brokenLinkCheck')}
          subtitle={t('lightBookmarks.scanNow')}
          height={rowHeight}
          divided={divided}
          onPress={() => setChecking(true)}
          testID="bookmark-manager-links"
        />
      );
    },
    [bookmarksBar, counts, enterTagsMode, openRow, rowHeight, t, updateSetting],
  );

  const range = useCallback(
    (item: Item, index: number): [number, number] => {
      if (item.kind === 'folder') return [0, Math.max(0, folderCount - 1)];
      if (item.kind === 'bookmark') return [folderCount, Math.max(folderCount, rows.length - 1)];
      return [index, index];
    },
    [folderCount, rows.length],
  );

  const crumbs: { id: string | null; name: string; tags?: boolean }[] = tagsMode
    ? [
        { id: null, name: t('browserBookmarks.allTags') },
        { id: null, name: t('lightBookmarks.tagsNotes'), tags: true },
      ]
    : [{ id: null, name: t('browserBookmarks.allTags') }, ...path.map((f) => ({ id: f.id, name: f.name }))];
  const showCrumbs = tab === 'bookmarks' && (tagsMode || (path.length > 0 && !searching));

  // In the folders view the header is SortableRows' own (it pads the gutters); on the reading list DsScreen pads.
  const header = (
    <View style={tab === 'reading' ? { gap: ds.space.stack } : { paddingHorizontal: ds.space.screenX, gap: ds.space.stack, paddingBottom: ds.space.stack }}>
      <DsHeader
        title={t('browserBookmarks.title')}
        subtitle={tp('plurals.itemsOther', total, { count: total })}
        action={{ icon: 'search', accessibilityLabel: t('lightBookmarks.searchOpenA11y'), onPress: openSearch, testID: 'bookmark-manager-search-button' }}
        testID="bookmark-manager-header"
      />
      {fieldVisible && tab === 'bookmarks' ? (
        <DsSearchField
          ref={searchRef}
          value={query}
          onChangeText={setQuery}
          placeholder={t('browserBookmarks.searchPlaceholder')}
          autoFocus={!tagsMode}
          returnKeyType="search"
          actions={[{ icon: 'x', accessibilityLabel: t('lightBookmarks.searchCloseA11y'), onPress: closeSearch, testID: 'bookmark-manager-search-close' }]}
          testID="bookmark-manager-search"
        />
      ) : null}
      <DsChipRow testID="bookmark-manager-tabs">
        <DsChip label={t('lightBookmarks.chipFolders')} selected={tab === 'bookmarks'} onPress={() => (tab === 'bookmarks' ? goToFolder(null) : setTab('bookmarks'))} testID="bookmark-chip-folders" />
        <DsChip label={t('browserBookmarks.tabReading')} selected={tab === 'reading'} onPress={() => setTab('reading')} testID="bookmark-chip-reading" />
        <DsChip label={t('history.title')} onPress={() => navigation.push(routePaths.history)} testID="bookmark-chip-history" />
        <DsChip label={t('lightBookmarks.chipNotes')} onPress={() => navigation.push(routePaths.notes)} testID="bookmark-chip-notes" />
      </DsChipRow>
      {tagsMode && tags.length > 0 ? (
        <DsChipRow testID="bookmark-manager-tag-chips">
          {[{ tag: null as string | null, count: 0 }, ...tags].map((chip) => (
            <DsChip
              key={chip.tag ?? '__all'}
              label={chip.tag ? `#${chip.tag}` : t('browserBookmarks.allTags')}
              selected={chip.tag === tag}
              accessibilityLabel={chip.tag ? t('browserBookmarks.tagA11y', { tag: chip.tag }) : t('browserBookmarks.allTags')}
              onPress={() => setTag(chip.tag)}
              testID={`bookmark-tag-${chip.tag ?? 'all'}`}
            />
          ))}
        </DsChipRow>
      ) : null}
      {showCrumbs ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: rtl.rowDirection, alignItems: 'center' }}>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <View key={crumb.tags ? 'tags' : (crumb.id ?? 'root')} style={{ flexDirection: rtl.rowDirection, alignItems: 'center' }}>
                {index > 0 ? <DsText variant="rowSub">{rtl.isRtl ? ' ‹ ' : ' › '}</DsText> : null}
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={t('browserBookmarks.breadcrumbA11y', { name: crumb.name })}
                  accessibilityState={{ selected: last }}
                  disabled={last}
                  onPress={() => goToFolder(crumb.id)}
                  testID={`bookmark-crumb-${crumb.tags ? 'tags' : (crumb.id ?? 'root')}`}
                  style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 2 }}>
                  <DsText variant={last ? 'tile' : 'rowSub'} color={last ? 'textPrimary' : 'primary'}>
                    {crumb.name}
                  </DsText>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      ) : null}
      {importProgress ? (
        <DsText variant="body" accessibilityLiveRegion="polite">
          {t('browserBookmarks.importing', importProgress)}
        </DsText>
      ) : null}
      {tab === 'bookmarks' && items.length === 0 ? (
        <DsText variant="body" align="center" style={{ paddingVertical: 24 }}>
          {searching ? t('browserBookmarks.emptySearch') : t('browserBookmarks.empty')}
        </DsText>
      ) : null}
    </View>
  );

  const footer = !searching ? (
    <View style={{ paddingHorizontal: ds.space.screenX, paddingTop: ds.space.stack, gap: ds.space.stack }}>
      <DsSectionLabel>{t('lightBookmarks.manage')}</DsSectionLabel>
      <DsRowGroup testID="bookmark-manager-manage">
        <DsRow icon="download" title={t('lightBookmarks.importExport')} onPress={() => setManageOpen(true)} testID="bookmark-manager-import-export" />
        <DsRow icon="smartphone" title={t('browserBookmarks.addToHome')} onPress={addCurrentPageToHome} testID="bookmark-manager-add-home" />
        <DsRow icon="tag" title={t('browserBookmarks.bookmarkAllTabs')} onPress={() => void bookmarkAllTabs()} testID="bookmark-manager-bookmark-all" />
      </DsRowGroup>
    </View>
  ) : null;

  const listCard = {
    height: items.length * rowHeight + 2,
    marginHorizontal: ds.space.screenX,
    backgroundColor: theme.colors.card,
    borderRadius: ds.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    overflow: 'hidden' as const,
  };

  return (
    <DsScreen testID="bookmark-manager" scroll={tab === 'reading'}>
      {tab === 'reading' ? (
        <>
          {header}
          <ReadingListView onOpen={(uri) => void openReadingListUri(uri, openInBrowser)} />
        </>
      ) : (
        <SortableRows
          items={items}
          rowHeight={rowHeight}
          dragEnabled={!searching}
          range={range}
          renderRow={renderRow}
          onMove={moveTo}
          onHold={(id) => setOptions(rows.find((r) => r.id === id) ?? null)}
          header={header}
          footer={footer}
          listStyle={items.length === 0 ? { height: 0 } : listCard}
          testID="bookmark-manager-list"
        />
      )}

      <ActionSheetModal visible={manageOpen} actions={manageActions} title={t('lightBookmarks.importExport')} onClose={() => setManageOpen(false)} />
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
    </DsScreen>
  );
});
