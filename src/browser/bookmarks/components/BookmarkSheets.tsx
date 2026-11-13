import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { Icon } from '@/components/base/Icon';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTranslation } from '@/localization';
import { bookmarkOrganizerRepository, type BookmarkFolder, type OrganizedBookmark } from '@/storage/repositories';

import { bookmarkEditRequests, change } from '../bookmarks.service';

/** #77: a folder's name (new folder or rename). */
export const FolderNameSheet = memo(function FolderNameSheet({
  visible,
  title,
  initial,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const { t, rtl } = useTranslation();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (visible) {
      setName(initial);
      setError(undefined);
    }
  }, [initial, visible]);
  const save = () => {
    if (!name.trim()) {
      setError(t('browserBookmarks.invalidName'));
      return;
    }
    onSave(name.trim());
    onClose();
  };
  return (
    <SheetFrame
      visible={visible}
      title={title}
      onClose={onClose}
      testID="bookmark-folder-name-sheet"
      footer={
        <View style={{ flexDirection: rtl.rowDirection, gap: 12 }}>
          <Button title={t('common.cancel')} variant="outline" onPress={onClose} style={{ flex: 1 }} />
          <Button title={t('common.save')} onPress={save} style={{ flex: 1 }} testID="bookmark-folder-name-save" />
        </View>
      }>
      <TextField
        label={t('browserBookmarks.folderName')}
        accessibilityLabel={t('browserBookmarks.folderNameA11y')}
        value={name}
        onChangeText={(text) => {
          setName(text);
          setError(undefined);
        }}
        maxLength={80}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={save}
        error={error}
        testID="bookmark-folder-name-field"
      />
    </SheetFrame>
  );
});

/** #77 "Move to folder" / the Edit sheet's folder: the root and every folder, indented; `exclude` hides a folder's own subtree. */
export const FolderPickerSheet = memo(function FolderPickerSheet({
  visible,
  selected,
  exclude,
  onPick,
  onClose,
}: {
  visible: boolean;
  selected: string | null;
  exclude?: string | null;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const { t, rtl } = useTranslation();
  const [folders, setFolders] = useState<(BookmarkFolder & { depth: number })[]>([]);
  useEffect(() => {
    if (!visible) return;
    void bookmarkOrganizerRepository
      .listAllFolders()
      .then(setFolders)
      .catch(() => setFolders([]));
  }, [visible]);
  // Hide the excluded folder and everything under it (a folder can't go into itself).
  const hidden = new Set<string>();
  if (exclude) {
    hidden.add(exclude);
    for (const f of folders) if (f.parentId && hidden.has(f.parentId)) hidden.add(f.id);
  }
  const rows: { id: string | null; name: string; depth: number }[] = [
    { id: null, name: t('browserBookmarks.root'), depth: 0 },
    ...folders.filter((f) => !hidden.has(f.id)).map((f) => ({ id: f.id, name: f.name, depth: f.depth + 1 })),
  ];
  return (
    <SheetFrame visible={visible} title={t('browserBookmarks.moveToTitle')} onClose={onClose} testID="bookmark-folder-picker">
      <View accessibilityRole="radiogroup">
        {rows.map((row) => {
          const isSelected = row.id === selected;
          return (
            <Pressable
              key={row.id ?? 'root'}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={row.name}
              onPress={() => {
                onPick(row.id);
                onClose();
              }}
              testID={`bookmark-folder-pick-${row.id ?? 'root'}`}
              style={{
                minHeight: 48,
                flexDirection: rtl.rowDirection,
                alignItems: 'center',
                gap: 10,
                ...(rtl.isRtl ? { paddingRight: row.depth * 16 } : { paddingLeft: row.depth * 16 }),
              }}>
              <Icon name={row.id ? 'folder-outline' : 'bookmark-outline'} size={20} color={isSelected ? 'primary' : 'secondary'} />
              <Text variant="body" color={isSelected ? 'primary' : 'textPrimary'} style={{ flex: 1 }} numberOfLines={2}>
                {row.name}
              </Text>
              {isSelected ? <Icon name="check" size={20} color="primary" /> : null}
            </Pressable>
          );
        })}
      </View>
    </SheetFrame>
  );
});

/** #78 / #92 / #93 — Edit bookmark: title, address (checked), folder, tags, note. */
export const BookmarkEditSheet = memo(function BookmarkEditSheet({
  bookmarkId,
  onClose,
}: {
  bookmarkId: string | null;
  onClose: () => void;
}) {
  const { t, rtl } = useTranslation();
  const [bookmark, setBookmark] = useState<OrganizedBookmark | null>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!bookmarkId) {
      setBookmark(null);
      return;
    }
    let cancelled = false;
    void bookmarkOrganizerRepository.get(bookmarkId).then((found) => {
      if (cancelled || !found) return;
      setBookmark(found);
      setTitle(found.title);
      setUrl(found.url);
      setTags(found.tags.join(', '));
      setNote(found.note);
      setFolderId(found.folderId);
      setError(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [bookmarkId]);

  useEffect(() => {
    if (!folderId) {
      setFolderName(t('browserBookmarks.root'));
      return;
    }
    void bookmarkOrganizerRepository.folderPath(folderId).then((path) => setFolderName(path.map((f) => f.name).join(' › ')));
  }, [folderId, t]);

  const save = async () => {
    if (!bookmark) return;
    const ok = await change(
      () =>
        bookmarkOrganizerRepository.updateDetails(bookmark.id, {
          title,
          url,
          folderId,
          note,
          tags: tags.split(','),
        }),
      t('browserBookmarks.saved'),
    );
    if (ok !== null) onClose();
    else if (!/^https?:\/\//i.test(url.trim())) setError(t('browserBookmarks.invalidUrl'));
  };

  return (
    <SheetFrame
      visible={bookmarkId != null && bookmark != null}
      title={t('browserBookmarks.editTitle')}
      onClose={onClose}
      testID="bookmark-edit-sheet"
      footer={
        <View style={{ flexDirection: rtl.rowDirection, gap: 12 }}>
          <Button title={t('common.cancel')} variant="outline" onPress={onClose} style={{ flex: 1 }} />
          <Button title={t('common.save')} onPress={() => void save()} style={{ flex: 1 }} testID="bookmark-edit-save" />
        </View>
      }>
      <View style={{ gap: 12 }}>
        <TextField label={t('browserBookmarks.fieldTitle')} value={title} onChangeText={setTitle} maxLength={500} testID="bookmark-edit-title" />
        <TextField
          label={t('browserBookmarks.fieldUrl')}
          value={url}
          onChangeText={(text) => {
            setUrl(text);
            setError(undefined);
          }}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          error={error}
          testID="bookmark-edit-url"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('browserBookmarks.fieldFolder')}: ${folderName}`}
          onPress={() => setPicking(true)}
          testID="bookmark-edit-folder"
          style={{ minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 10 }}>
          <Icon name="folder-outline" size={20} color="secondary" />
          <View style={{ flex: 1 }}>
            <Text variant="label" color="textSecondary">
              {t('browserBookmarks.fieldFolder')}
            </Text>
            <Text variant="body" numberOfLines={2}>
              {folderName}
            </Text>
          </View>
          <Icon name={rtl.isRtl ? 'chevron-left' : 'chevron-right'} size={20} color="secondary" />
        </Pressable>
        <TextField
          label={t('browserBookmarks.fieldTags')}
          helperText={t('browserBookmarks.fieldTagsHint')}
          value={tags}
          onChangeText={setTags}
          autoCapitalize="none"
          testID="bookmark-edit-tags"
        />
        <TextField
          label={t('browserBookmarks.fieldNote')}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={2000}
          testID="bookmark-edit-note"
        />
      </View>
      <FolderPickerSheet visible={picking} selected={folderId} onPick={setFolderId} onClose={() => setPicking(false)} />
    </SheetFrame>
  );
});

/** The Edit sheet wherever it is asked for (the browser's star when the page is bookmarked; the bookmarks screen). */
// Several hosts can be mounted (the browser under the Bookmarks screen): only the newest shows the sheet.
let hostCounter = 0;
const hostStack: number[] = [];
const hostListeners = new Set<() => void>();
const hostTop = () => hostStack[hostStack.length - 1] ?? -1;
const subscribeHosts = (listener: () => void) => {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
};

export const BookmarkEditHost = memo(function BookmarkEditHost() {
  const [hostId] = useState(() => ++hostCounter);
  useEffect(() => {
    hostStack.push(hostId);
    hostListeners.forEach((listener) => listener());
    return () => {
      const at = hostStack.indexOf(hostId);
      if (at >= 0) hostStack.splice(at, 1);
      hostListeners.forEach((listener) => listener());
    };
  }, [hostId]);
  const top = useSyncExternalStore(subscribeHosts, hostTop, hostTop);
  const id = useSyncExternalStore(bookmarkEditRequests.subscribe, bookmarkEditRequests.get, bookmarkEditRequests.get);
  if (top !== hostId) return null;
  return <BookmarkEditSheet bookmarkId={id} onClose={() => bookmarkEditRequests.close()} />;
});
