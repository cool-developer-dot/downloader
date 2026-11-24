import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsCard, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation, type TranslationKey } from '@/localization';
import type { PlayerOptionContext } from '@/player/options';
import { SUBTITLE_COLOR_HEX, type SubtitleColor } from '@/player/subtitles/subtitle-style';

import { PlayerDesignPage } from './PlayerDesignPage';
import { PlayerOptionRows } from './PlayerOptionRows';

/** Design 21's four swatches, in its order. */
const SWATCHES: readonly SubtitleColor[] = ['black', 'white', 'yellow', 'red'];
const COLOR_LABELS: Record<SubtitleColor, TranslationKey> = {
  white: 'videoPlayer.subtitleColorWhite',
  yellow: 'videoPlayer.subtitleColorYellow',
  black: 'videoPlayer.subtitleColorBlack',
  red: 'videoPlayer.subtitleColorRed',
  green: 'videoPlayer.subtitleColorGreen',
  cyan: 'videoPlayer.subtitleColorCyan',
};

export type SubtitlesPageProps = {
  visible: boolean;
  context: PlayerOptionContext;
  /** The video's title (design 21's "Episode 1"). */
  videoTitle: string | null;
  color: SubtitleColor;
  onColor: (color: SubtitleColor) => void;
  /** P4's style sheet: size, font, background / outline, position. */
  onOpenStyle: () => void;
  onBack: () => void;
  onSettings: () => void;
};

/** Design 21: P3's and P4's subtitle rows, with the Style card (colour swatches, the rest in P4's sheet). */
export const SubtitlesPage = memo(function SubtitlesPage({
  visible,
  context,
  videoTitle,
  color,
  onColor,
  onOpenStyle,
  onBack,
  onSettings,
}: SubtitlesPageProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rtl = useRtl();
  return (
    <PlayerDesignPage
      visible={visible}
      title={t('playerDesign.subtitlesTitle')}
      subtitle={videoTitle ?? undefined}
      onBack={onBack}
      onSettings={onSettings}
      testID="player-subtitles-page">
      <PlayerOptionRows
        context={context}
        ids={['p3.load', 'p3.autoDetect', 'p3.track', 'p4.second', 'p3.sync']}
        onClosePage={onBack}
      />
      <DsCard>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('playerDesign.styleA11y')}
          onPress={onOpenStyle}
          style={{ margin: -ds.space.cardPad, padding: ds.space.cardPad, gap: 10 }}
          testID="player-subtitles-style">
          <DsText variant="rowTitle">{t('playerDesign.styleTitle')}</DsText>
          <View style={{ flexDirection: rtl.rowDirection, gap: 10 }}>
            {SWATCHES.map((swatch) => {
              const selected = swatch === color;
              return (
                <Pressable
                  key={swatch}
                  accessibilityRole="radio"
                  accessibilityLabel={t('playerDesign.swatchA11y', { color: t(COLOR_LABELS[swatch]) })}
                  accessibilityState={{ selected }}
                  onPress={() => onColor(swatch)}
                  hitSlop={4}
                  testID={`player-subtitles-swatch-${swatch}`}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: SUBTITLE_COLOR_HEX[swatch],
                    borderWidth: selected ? 3 : 1,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                  }}
                />
              );
            })}
          </View>
          <DsText variant="rowSub">{t('playerDesign.styleLine')}</DsText>
        </Pressable>
      </DsCard>
      <PlayerOptionRows context={context} ids={['p3.encoding', 'p3.off']} onClosePage={onBack} />
    </PlayerDesignPage>
  );
});
