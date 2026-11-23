import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { MAX_BOOKMARK_NAME_LENGTH, normalizeBookmarkName } from '@/player/video-bookmarks';

export type BookmarkNameModalProps = {
  visible: boolean;
  title: string;
  /** Where the bookmark is ("1:23"). */
  timeLabel: string;
  initialName: string;
  /** The name, or null for none (the bookmark is then shown by its time). */
  onSave: (name: string | null) => void;
  onClose: () => void;
};

/** P9 #705: a bookmark's optional name, when adding one or renaming it. Urdu and English, up to 80 characters. */
export const BookmarkNameModal = memo(function BookmarkNameModal(props: BookmarkNameModalProps) {
  if (!props.visible) {
    return null;
  }
  // Keyed: each opening starts from its own name.
  return <BookmarkNameForm key={`${props.title}:${props.timeLabel}:${props.initialName}`} {...props} />;
});

function BookmarkNameForm({ title, timeLabel, initialName, onSave, onClose }: BookmarkNameModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialName);
  const save = () => onSave(normalizeBookmarkName(draft));
  return (
    <AppModal visible onClose={onClose} title={title} testID="player-bookmark-name-modal">
      <View style={styles.form}>
        <DsText variant="rowSub">{t('libraryStats.bookmarkAt', { time: timeLabel })}</DsText>
        <TextField
          label={t('libraryStats.bookmarkName')}
          value={draft}
          onChangeText={setDraft}
          maxLength={MAX_BOOKMARK_NAME_LENGTH + 20}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={save}
          accessibilityLabel={t('libraryStats.bookmarkName')}
          testID="player-bookmark-name-field"
        />
        <DsButtonRow>
          <DsButton label={t('libraryStats.bookmarkSave')} flex onPress={save} testID="player-bookmark-name-save" />
          <DsButton label={t('common.cancel')} variant="secondary" flex onPress={onClose} testID="player-bookmark-name-cancel" />
        </DsButtonRow>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 12,
  },
});
