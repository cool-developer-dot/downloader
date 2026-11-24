import { memo } from 'react';

import { DsRow, DsTile, DsTileGrid, type DsIconName } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import type { PlayerOptionContext } from '@/player/options';

import { PlayerDesignPage } from './PlayerDesignPage';
import { CLOSES_PAGE_IDS, PlayerOptionRows, playerOptionEntry } from './PlayerOptionRows';

/**
 * Design 24's tiles, each one of the ⋮ sheet's tool rows. Its Screen rec and Watermark tiles are features the owner
 * set as Not planned; Bookmark and Playlist (P9, P7) take their places.
 */
const TILES: readonly { id: string; icon: DsIconName; label: TranslationKey }[] = [
  { id: 'p10.trim', icon: 'scissors', label: 'playerDesign.tileTrim' },
  { id: 'p12.mergeVideos', icon: 'link', label: 'playerDesign.tileMerge' },
  { id: 'p10.compress', icon: 'archive', label: 'playerDesign.tileCompress' },
  { id: 'p10.converter', icon: 'refresh-cw', label: 'playerDesign.tileConvert' },
  { id: 'p10.extractAudio', icon: 'music', label: 'playerDesign.tileExtract' },
  { id: 'p12.createGif', icon: 'image', label: 'playerDesign.tileGif' },
  { id: 'p10.screenshot', icon: 'camera', label: 'playerDesign.tileScreenshot' },
  { id: 'p9.addBookmark', icon: 'bookmark', label: 'playerDesign.tileBookmark' },
  { id: 'p7.addToPlaylist', icon: 'list', label: 'playerDesign.tilePlaylist' },
];

export type VideoToolsPageProps = {
  visible: boolean;
  context: PlayerOptionContext;
  /** P13: the Cast row, when a Cast device is around (or the video is casting). */
  cast: { deviceName: string | null; casting: boolean; onPress: () => void } | null;
  onBack: () => void;
  onSettings: () => void;
};

/** Design 24: the edit tools as tiles, then Change speed, Cast, the stream rows and the video's other tools. */
export const VideoToolsPage = memo(function VideoToolsPage({ visible, context, cast, onBack, onSettings }: VideoToolsPageProps) {
  const { t } = useTranslation();
  const tiles = TILES.flatMap((tile) => {
    const entry = playerOptionEntry(context, tile.id);
    return entry ? [{ ...tile, entry }] : [];
  });
  return (
    <PlayerDesignPage
      visible={visible}
      title={t('playerDesign.toolsTitle')}
      subtitle={t('playerDesign.toolsSub')}
      onBack={onBack}
      onSettings={onSettings}
      testID="player-tools-page">
      {tiles.length > 0 ? (
        <DsTileGrid testID="player-tools-tiles">
          {tiles.map(({ id, icon, label, entry }) => (
            <DsTile
              key={id}
              icon={icon}
              label={t(label)}
              accessibilityLabel={t(entry.row.label)}
              accessibilityHint={entry.row.subtitle ? t(entry.row.subtitle) : undefined}
              onPress={
                entry.enabled
                  ? () => {
                      if (CLOSES_PAGE_IDS.has(id)) {
                        onBack();
                        requestAnimationFrame(() => entry.row.onPress(context));
                      } else {
                        entry.row.onPress(context);
                      }
                    }
                  : undefined
              }
              style={entry.enabled ? undefined : { opacity: 0.45 }}
              testID={`player-tools-tile-${id}`}
            />
          ))}
        </DsTileGrid>
      ) : null}
      <PlayerOptionRows
        context={context}
        ids={['p12.changeSpeed']}
        titles={{ 'p12.changeSpeed': 'playerDesign.rowChangeSpeed' }}
        onClosePage={onBack}>
        {cast ? (
          <DsRow
            icon="cast"
            title={t('playerDesign.rowCast')}
            subtitle={
              cast.casting && cast.deviceName
                ? t('playerDesign.rowCastOn', { device: cast.deviceName })
                : t('playerDesign.rowCastSub')
            }
            onPress={cast.onPress}
            testID="player-tools-cast"
          />
        ) : null}
      </PlayerOptionRows>
      <PlayerOptionRows
        context={context}
        ids={[
          'p14.streamQuality',
          'p14.downloadStream',
          'p9.bookmarks',
          'p8.customizeControls',
          'p1.saveToLibrary',
          'p11.moveToPrivate',
          'p9.quickDelete',
        ]}
        titles={{ 'p14.streamQuality': 'playerDesign.rowAdaptive' }}
        onClosePage={onBack}
      />
    </PlayerDesignPage>
  );
});
