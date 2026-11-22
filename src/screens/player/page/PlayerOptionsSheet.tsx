import { Fragment, memo } from 'react';
import { Modal, Pressable as RNPressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DsRow, DsRowGroup, DsSectionLabel, DsText, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { playerOptions, type PlayerOptionContext, type PlayerOptionSection } from '@/player/options';
import { useTourBlocker } from '@/tour/tour-store';

const SECTION_LABELS: Record<PlayerOptionSection, TranslationKey> = {
  playback: 'videoPlayer.sectionPlayback',
  video: 'videoPlayer.sectionVideo',
  audio: 'videoPlayer.sectionAudio',
  subtitles: 'videoPlayer.sectionSubtitles',
  tools: 'videoPlayer.sectionTools',
};

export type PlayerOptionsSheetProps = {
  visible: boolean;
  /** What the rows read and act on (built by the Player screen while the sheet is open). */
  context: PlayerOptionContext;
  onClose: () => void;
  /** P3: one section alone, under its own title (the Subs chip opens Subtitles). Default: all sections. */
  only?: PlayerOptionSection;
  title?: string;
  testID?: string;
};

/**
 * The ⋮ options sheet (page header, video card, full-screen top bar): the registry's sections — Playback, Video,
 * Audio, Subtitles, Tools — each with the rows the packages registered (src/player/options). A section with no rows
 * is left out. A row runs once the sheet has closed, so a sheet it opens comes up on its own; an on / off row is a
 * switch and leaves the sheet open.
 */
export const PlayerOptionsSheet = memo(function PlayerOptionsSheet({
  visible,
  context,
  onClose,
  only,
  title,
  testID = 'player-options-sheet',
}: PlayerOptionsSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  useTourBlocker(visible);

  if (!visible) return null;

  const sections = playerOptions.sections(context).filter((view) => !only || view.section === only);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID={testID}
          style={{
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingTop: 8,
            paddingBottom: insets.bottom + 12,
            maxHeight: '85%',
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <View style={styles.title}>
            <DsText variant="cardTitle" accessibilityRole="header">
              {title ?? t('videoPlayer.optionsTitle')}
            </DsText>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 8, gap: ds.space.stack }}
            showsVerticalScrollIndicator={false}>
            {sections.map((view, index) => (
              <Fragment key={view.section}>
                {only ? null : (
                  <DsSectionLabel first={index === 0} testID={`player-options-section-${view.section}`}>
                    {t(SECTION_LABELS[view.section])}
                  </DsSectionLabel>
                )}
                <DsRowGroup>
                  {view.rows.map(({ row, enabled, value, toggle }) =>
                    toggle != null ? (
                      // An on / off row: the switch flips it and the sheet stays open.
                      <DsRow
                        key={row.id}
                        icon={row.icon}
                        title={t(row.label)}
                        subtitle={row.subtitle ? t(row.subtitle) : undefined}
                        toggle={{
                          value: toggle,
                          onValueChange: () => row.onPress(context),
                          accessibilityHint: row.subtitle ? t(row.subtitle) : undefined,
                        }}
                        disabled={!enabled}
                        testID={`player-option-${row.id}`}
                      />
                    ) : (
                      <DsRow
                        key={row.id}
                        icon={row.icon}
                        title={t(row.label)}
                        subtitle={row.subtitle ? t(row.subtitle) : undefined}
                        value={value ?? undefined}
                        disabled={!enabled}
                        onPress={() => {
                          onClose();
                          requestAnimationFrame(() => row.onPress(context));
                        }}
                        testID={`player-option-${row.id}`}
                      />
                    ),
                  )}
                </DsRowGroup>
              </Fragment>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  title: { paddingHorizontal: ds.space.screenX, paddingBottom: ds.space.stack },
});
