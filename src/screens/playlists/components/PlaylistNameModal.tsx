import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow } from '@/design';
import { useTranslation } from '@/localization';
import { MAX_PLAYLIST_NAME_LENGTH, normalizePlaylistName } from '@/playlists/playlist-names';

export type PlaylistNameModalProps = {
  visible: boolean;
  title: string;
  initialName: string;
  confirmLabel: string;
  onSave: (name: string) => void;
  onClose: () => void;
  testID?: string;
};

/** P7 #617 / #618: a playlist's name, for a new playlist or a rename (Urdu and English, up to 80 characters). */
export const PlaylistNameModal = memo(function PlaylistNameModal(props: PlaylistNameModalProps) {
  if (!props.visible) {
    return null;
  }
  // Keyed: each opening starts from its own name.
  return <PlaylistNameForm key={`${props.title}:${props.initialName}`} {...props} />;
});

function PlaylistNameForm({ title, initialName, confirmLabel, onSave, onClose, testID = 'playlist-name-modal' }: PlaylistNameModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialName);
  const clean = normalizePlaylistName(draft);
  const save = () => {
    if (clean) {
      onSave(clean);
    }
  };
  return (
    <AppModal visible onClose={onClose} title={title} testID={testID}>
      <View style={styles.form}>
        <TextField
          label={t('playlists.nameLabel')}
          value={draft}
          onChangeText={setDraft}
          maxLength={MAX_PLAYLIST_NAME_LENGTH + 20}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={save}
          accessibilityLabel={t('playlists.nameLabel')}
          testID={`${testID}-field`}
        />
        <DsButtonRow>
          <DsButton label={confirmLabel} flex disabled={!clean} onPress={save} testID={`${testID}-save`} />
          <DsButton label={t('common.cancel')} variant="secondary" flex onPress={onClose} testID={`${testID}-cancel`} />
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
