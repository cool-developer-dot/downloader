import { memo, useCallback, useEffect, useState } from 'react';
import { FlatList, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { SearchField } from '@/components/inputs/SearchField';
import { TextField } from '@/components/inputs/TextField';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { deleteNote, listNotes, updateNote, useNotesVersion } from '@/browser/notes/notes.service';
import { loadUrlActiveTab } from '@/browser/services';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import type { Note } from '@/storage/repositories/notes.repository';

/** B22 #252 — Notes: search, edit, delete, copy, share, and open the page a note came from. */
export const NotesScreen = memo(function NotesScreen() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const changes = useNotesVersion();
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listNotes(query).then((list) => {
      if (!cancelled) setNotes(list);
    });
    return () => {
      cancelled = true;
    };
  }, [changes, query]);

  const open = useCallback((note: Note) => {
    setEditing(note);
    setDraft(note.text);
  }, []);
  const close = () => setEditing(null);

  return (
    <SafeAreaScreen
      testID="notes-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader title={t('browserShare.notes')} showBack onBackPress={() => navigation.back()} />
      <Box px={16} py={8}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          onSearch={() => undefined}
          placeholder={t('browserShare.notesSearch')}
          testID="notes-search"
        />
      </Box>
      <FlatList
        data={notes}
        keyExtractor={(note) => note.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 8 }}
        ListEmptyComponent={
          <Text variant="bodySmall" color="textSecondary" style={{ textAlign: rtl.textAlign, paddingVertical: 24 }}>
            {query.trim() ? t('browserShare.notesNoMatches', { query: query.trim() }) : t('browserShare.notesEmpty')}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint={t('browserShare.noteActionsA11y')}
            onPress={() => open(item)}
            testID={`notes-item-${item.id}`}
            style={{
              minHeight: 48,
              padding: 12,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.card,
              gap: 4,
            }}>
            <Text variant="body" numberOfLines={4} style={{ textAlign: rtl.textAlign }}>
              {item.text}
            </Text>
            {item.pageTitle || item.pageUrl ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
                {t('browserShare.noteFromPage', { title: item.pageTitle || item.pageUrl })}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
      <SheetFrame
        visible={editing != null && !confirmDelete}
        title={t('browserShare.noteEdit')}
        onClose={close}
        testID="notes-edit-sheet"
        footer={
          editing ? (
            <View style={{ flexDirection: rtl.rowDirection, gap: 8, flexWrap: 'wrap' }}>
              <Button
                title={t('browserShare.noteSave')}
                onPress={() => {
                  void updateNote(editing.id, draft);
                  close();
                }}
                testID="notes-save"
              />
              <Button
                title={t('browserShare.noteCopy')}
                variant="outline"
                onPress={() => void Clipboard.setStringAsync(draft)}
                testID="notes-copy"
              />
              <Button
                title={t('browserShare.noteShare')}
                variant="outline"
                onPress={() => void Share.share({ message: draft }).catch(() => undefined)}
                testID="notes-share"
              />
              {editing.pageUrl ? (
                <Button
                  title={t('browserShare.noteOpenPage')}
                  variant="outline"
                  onPress={() => {
                    close();
                    navigation.push(routePaths.browser);
                    loadUrlActiveTab(editing.pageUrl);
                  }}
                  testID="notes-open-page"
                />
              ) : null}
              <Button
                title={t('browserShare.noteDelete')}
                variant="outline"
                onPress={() => setConfirmDelete(true)}
                testID="notes-delete"
              />
            </View>
          ) : undefined
        }>
        <TextField
          label={t('browserShare.noteEdit')}
          value={draft}
          onChangeText={setDraft}
          multiline
          testID="notes-edit-field"
        />
      </SheetFrame>
      <ConfirmModal
        visible={confirmDelete}
        variant="delete"
        title={t('browserShare.noteDeleteTitle')}
        message={t('browserShare.noteDeleteMessage')}
        confirmLabel={t('browserShare.noteDelete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setConfirmDelete(false);
          if (editing) void deleteNote(editing.id);
          close();
        }}
        onCancel={() => setConfirmDelete(false)}
        testID="notes-delete-confirm"
      />
    </SafeAreaScreen>
  );
});
