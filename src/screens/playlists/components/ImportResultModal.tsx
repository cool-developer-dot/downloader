import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { locationFileName, type M3uEntry } from '@/playlists/m3u';
import type { PlaylistImportOutcome } from '@/playlists/playlists-service';

export type ImportResult = Extract<PlaylistImportOutcome, { kind: 'done' }>;

export type ImportResultModalProps = {
  result: ImportResult | null;
  onOpenPlaylist: (id: string) => void;
  onClose: () => void;
};

function entryLabel(entry: M3uEntry): string {
  return entry.title ?? (locationFileName(entry.location) || entry.location);
}

/**
 * P7 #629: what an import did — how many videos went into the new playlist, the lines no library video matched (by
 * name, so the user can find them), and how many web links were skipped.
 */
export const ImportResultModal = memo(function ImportResultModal({ result, onOpenPlaylist, onClose }: ImportResultModalProps) {
  const { t, tp } = useTranslation();
  if (!result) {
    return null;
  }
  const playlist = result.playlist;
  return (
    <AppModal
      visible
      onClose={onClose}
      title={playlist ? t('playlists.importedTitle') : t('playlists.nothingImportedTitle')}
      testID="playlist-import-result">
      <View style={styles.body}>
        <DsText variant="body">
          {playlist
            ? t('playlists.importedBody', { name: playlist.name, videos: tp('plurals.videosOther', result.added) })
            : t('playlists.noneFound')}
        </DsText>
        {result.skippedRemote > 0 ? (
          <DsText variant="rowSub">{t('playlists.skippedRemote', { count: result.skippedRemote })}</DsText>
        ) : null}
        {result.duplicates > 0 ? (
          <DsText variant="rowSub">{t('playlists.duplicates', { count: result.duplicates })}</DsText>
        ) : null}
        {result.notFound.length > 0 ? (
          <>
            <DsText variant="bodyStrong">{t('playlists.notFoundHeading', { count: result.notFound.length })}</DsText>
            <ScrollView style={styles.list} nestedScrollEnabled testID="playlist-import-not-found">
              {result.notFound.map((entry, index) => (
                <DsText key={`${index}:${entry.location}`} variant="rowSub" numberOfLines={2}>
                  {`• ${entryLabel(entry)}`}
                </DsText>
              ))}
            </ScrollView>
          </>
        ) : null}
        <DsButtonRow>
          {playlist ? (
            <DsButton
              label={t('playlists.openPlaylist')}
              flex
              onPress={() => onOpenPlaylist(playlist.id)}
              testID="playlist-import-open"
            />
          ) : null}
          <DsButton label={t('common.close')} variant="secondary" flex onPress={onClose} testID="playlist-import-close" />
        </DsButtonRow>
      </View>
    </AppModal>
  );
});

const styles = StyleSheet.create({
  body: {
    gap: 10,
  },
  list: {
    maxHeight: 220,
  },
});
