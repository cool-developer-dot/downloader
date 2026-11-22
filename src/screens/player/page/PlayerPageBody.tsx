import { memo } from 'react';
import { ScrollView } from 'react-native';

import { DsChip, DsChipRow, DsRow, DsRowGroup, DsTile, DsTileGrid, ds } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import { formatPlaybackRateChip, formatPlaybackRateLabel } from '@/player';

import { PAGE_TILES, shownPageChips, type PageChip, type PageTile, type PlayerPageAction } from './player-page-actions';

export type PlayerPageBodyProps = {
  playbackRate: number;
  seekStepSeconds: number;
  /** False while the video can't take commands (preparing, failed): the controls still show, greyed. */
  enabled: boolean;
  /** Locked: everything here is hidden from TalkBack as well as covered. */
  accessibilityHidden?: boolean;
  onAction: (action: PlayerPageAction) => void;
};

const CHIP_LABELS: Record<Exclude<PageChip, 'speed'>, { label: TranslationKey; a11y: TranslationKey }> = {
  subs: { label: 'videoPlayer.chipSubs', a11y: 'videoPlayer.chipSubsA11y' },
  audio: { label: 'videoPlayer.chipAudio', a11y: 'videoPlayer.chipAudio' },
  rotate: { label: 'videoPlayer.chipRotate', a11y: 'player.enterFullscreen' },
  lock: { label: 'videoPlayer.chipLock', a11y: 'player.lockScreen' },
};

/** The chips drawn: the design's row minus those switched off (Audio until Faran's P17). */
const SHOWN_CHIPS = shownPageChips();

const TILE_LABELS: Record<Exclude<PageTile['id'], 'skipBack'>, TranslationKey> = {
  customSeek: 'videoPlayer.tileCustomSeek',
  frameByFrame: 'videoPlayer.tileFrameByFrame',
  abRepeat: 'videoPlayer.tileAbRepeat',
  aspectRatio: 'videoPlayer.tileAspectRatio',
  mirrorFlip: 'videoPlayer.tileMirrorFlip',
};

/**
 * Screen 19 under the video card: the chip row (the speed chip drawn selected, showing the speed), two rows of tiles
 * (the first grows to fit "Frame by / frame") and the Up next card. Scrolls when the screen is short or the text large.
 */
export const PlayerPageBody = memo(function PlayerPageBody({
  playbackRate,
  seekStepSeconds,
  enabled,
  accessibilityHidden = false,
  onAction,
}: PlayerPageBodyProps) {
  const { t } = useTranslation();
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingTop: ds.space.grid, paddingBottom: 16, gap: ds.space.grid }}
      showsVerticalScrollIndicator={false}
      importantForAccessibility={accessibilityHidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={accessibilityHidden}
      testID="player-page-body">
      <DsChipRow testID="player-page-chips">
        {SHOWN_CHIPS.map((chip) =>
          chip === 'speed' ? (
            <DsChip
              key={chip}
              label={formatPlaybackRateChip(playbackRate)}
              selected
              disabled={!enabled}
              accessibilityLabel={t('player.playbackSpeedSelected', { rate: formatPlaybackRateLabel(playbackRate) })}
              onPress={() => onAction('speed')}
              testID="player-chip-speed"
            />
          ) : (
            <DsChip
              key={chip}
              label={t(CHIP_LABELS[chip].label)}
              accessibilityLabel={t(CHIP_LABELS[chip].a11y)}
              disabled={!enabled && chip !== 'lock'}
              onPress={() => onAction(chip)}
              testID={`player-chip-${chip}`}
            />
          ),
        )}
      </DsChipRow>
      <DsTileGrid testID="player-page-tiles">
        {PAGE_TILES.map((tile) => (
          <DsTile
            key={tile.id}
            icon={tile.icon}
            label={
              tile.id === 'skipBack'
                ? t('videoPlayer.tileSkipBack', { seconds: seekStepSeconds })
                : t(TILE_LABELS[tile.id])
            }
            labelLines={2}
            accessibilityLabel={
              tile.id === 'skipBack' ? t('videoPlayer.tileSkipBackA11y', { seconds: seekStepSeconds }) : undefined
            }
            accessibilityHint={tile.id === 'customSeek' ? t('videoPlayer.tileCustomSeekHint') : undefined}
            onPress={() => onAction(tile.action)}
            testID={`player-tile-${tile.id}`}
          />
        ))}
      </DsTileGrid>
      <DsRowGroup>
        <DsRow
          icon="skip-forward"
          title={t('videoPlayer.upNext')}
          subtitle={t('videoPlayer.upNextSubtitle')}
          trailing="chevron"
          onPress={() => onAction('upNext')}
          testID="player-up-next"
        />
      </DsRowGroup>
    </ScrollView>
  );
});
