import { Fragment, memo, useCallback } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { DsButton, DsIcon, DsRow, DsRowGroup, DsSectionLabel, DsText, DsToggle, type DsIconName } from '@/design';
import { useTranslation, type TranslateFn, type TranslationKey } from '@/localization';
import {
  controlsInGroup,
  moveControl,
  setControlShown,
  withGroupLayout,
  type ControlsLayout,
} from '@/player/controls-layout';

import {
  CONTROL_GROUPS,
  CONTROL_GROUP_REORDERS,
  availableControls,
  type ControlGroupId,
} from './player-controls-customize';
import { PAGE_TILES } from './player-page-actions';
import { PlayerSheetFrame } from './PlayerSheetFrame';
import { announcePlayer } from './use-player-not-yet';

const GROUP_LABELS: Readonly<Record<ControlGroupId, TranslationKey>> = {
  pageChips: 'videoPlayer.customizeGroupPageChips',
  pageTiles: 'videoPlayer.customizeGroupPageTiles',
  pageCards: 'videoPlayer.customizeGroupPageCards',
  fullscreenTop: 'videoPlayer.customizeGroupFullscreenTop',
  fullscreenVideo: 'videoPlayer.customizeGroupFullscreenVideo',
  fullscreenDock: 'videoPlayer.customizeGroupFullscreenDock',
};

/** What each control is called here (a control a later package adds without a name here shows its id). */
const CONTROL_LABELS: Readonly<Record<ControlGroupId, Partial<Record<string, TranslationKey>>>> = {
  pageChips: {
    speed: 'videoPlayer.customizeSpeedChip',
    subs: 'videoPlayer.chipSubsA11y',
    audio: 'videoPlayer.chipAudio',
    rotate: 'videoPlayer.chipRotate',
    lock: 'videoPlayer.chipLock',
  },
  pageTiles: {
    customSeek: 'videoPlayer.tileCustomSeek',
    frameByFrame: 'videoPlayer.tileFrameByFrame',
    abRepeat: 'videoPlayer.tileAbRepeat',
    aspectRatio: 'videoPlayer.tileAspectRatio',
    mirrorFlip: 'videoPlayer.tileMirrorFlip',
  },
  pageCards: { upNext: 'videoPlayer.upNext' },
  fullscreenTop: { orientation: 'player.orientationTitle', fullscreen: 'videoPlayer.customizeFullscreenButton' },
  fullscreenVideo: {
    previousNext: 'videoPlayer.customizePreviousNext',
    lock: 'videoPlayer.customizeLockButton',
  },
  fullscreenDock: { mute: 'videoPlayer.customizeMuteButton', speed: 'videoPlayer.customizeSpeedChip' },
};

const TILE_ICONS: Partial<Record<string, DsIconName>> = Object.fromEntries(PAGE_TILES.map((tile) => [tile.id, tile.icon]));

const CONTROL_ICONS: Readonly<Record<ControlGroupId, Partial<Record<string, DsIconName>>>> = {
  pageChips: { speed: 'gauge', subs: 'captions', audio: 'music', rotate: 'rotate-cw', lock: 'lock' },
  pageTiles: TILE_ICONS,
  pageCards: { upNext: 'skip-forward' },
  fullscreenTop: { orientation: 'rotate-cw', fullscreen: 'scan' },
  fullscreenVideo: { skipButtons: 'rewind', previousNext: 'skip-back', lock: 'lock' },
  fullscreenDock: { mute: 'volume-2', speed: 'gauge' },
};

/** ↑ / ↓: a plain 36 dp button (faded by the theme while the control is already first / last). */
function MoveButton({
  icon,
  accessibilityLabel,
  disabled,
  onPress,
  testID,
}: {
  icon: 'chevron-up' | 'chevron-down';
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={4}
      style={styles.moveButton}
      testID={testID}>
      <DsIcon name={icon} size={20} color="textPrimary" />
    </Pressable>
  );
}

function controlLabel(t: TranslateFn, group: ControlGroupId, id: string, seekStepSeconds: number): string {
  if (group === 'pageTiles' && id === 'skipBack') {
    return t('videoPlayer.tileSkipBackA11y', { seconds: seekStepSeconds });
  }
  if (group === 'fullscreenVideo' && id === 'skipButtons') {
    return t('videoPlayer.customizeSkipButtons', { seconds: seekStepSeconds });
  }
  const key = CONTROL_LABELS[group][id];
  return key ? t(key) : id;
}

export type CustomizeControlsSheetProps = {
  visible: boolean;
  layout: ControlsLayout;
  /** The chosen seek interval, for the "10 s" names. */
  seekStepSeconds: number;
  onChange: (layout: ControlsLayout) => void;
  onReset: () => void;
  onClose: () => void;
};

/**
 * P8 #692 Customize Controls: each group of the Player's controls (the page's chips, tiles and Up next card; the full
 * screen's top bar, buttons on the video and bottom bar), each control with a switch to show it and, where the group
 * has an order, ↑ / ↓ to move it. Changes apply at once and are remembered; Reset to default puts everything back.
 */
export const CustomizeControlsSheet = memo(function CustomizeControlsSheet({
  visible,
  layout,
  seekStepSeconds,
  onChange,
  onReset,
  onClose,
}: CustomizeControlsSheetProps) {
  const { t, rtl } = useTranslation();

  const move = useCallback(
    (group: ControlGroupId, id: string, direction: -1 | 1) => {
      const available = availableControls(group);
      const next = moveControl(available, layout[group], id, direction);
      if (!next) {
        return;
      }
      onChange(withGroupLayout(layout, group, next));
      // Spoken only (no toast): the list itself shows the new place.
      AccessibilityInfo.announceForAccessibility(
        t('videoPlayer.customizeMoved', {
          name: controlLabel(t, group, id, seekStepSeconds),
          position: next.order.indexOf(id) + 1,
          count: next.order.length,
        }),
      );
    },
    [layout, onChange, seekStepSeconds, t],
  );

  const show = useCallback(
    (group: ControlGroupId, id: string, shown: boolean) => {
      onChange(withGroupLayout(layout, group, setControlShown(availableControls(group), layout[group], id, shown)));
    },
    [layout, onChange],
  );

  const reset = useCallback(() => {
    onReset();
    announcePlayer(t('videoPlayer.customizeResetDone'));
  }, [onReset, t]);

  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('videoPlayer.customizeControls')}
      subtitle={t('videoPlayer.customizeControlsSubtitle')}
      onClose={onClose}
      testID="player-customize-controls-sheet">
      <DsText variant="rowSub">{t('videoPlayer.customizeFixedNote')}</DsText>
      {CONTROL_GROUPS.map((group, groupIndex) => {
        const entries = controlsInGroup(availableControls(group), layout[group]);
        const reorders = CONTROL_GROUP_REORDERS[group] && entries.length > 1;
        return (
          <Fragment key={group}>
            <DsSectionLabel first={groupIndex === 0} testID={`player-customize-${group}`}>
              {t(GROUP_LABELS[group])}
            </DsSectionLabel>
            <DsRowGroup>
              {entries.map(({ id, shown }, index) => {
                const name = controlLabel(t, group, id, seekStepSeconds);
                return (
                  <DsRow
                    key={id}
                    icon={CONTROL_ICONS[group][id] ?? 'circle'}
                    title={name}
                    subtitle={group === 'fullscreenVideo' && id === 'previousNext' ? t('videoPlayer.customizePreviousNextHint') : undefined}
                    testID={`player-customize-${group}-${id}`}
                    trailing={
                      <View style={[styles.trailing, { flexDirection: rtl.rowDirection }]}>
                        {reorders ? (
                          <>
                            <MoveButton
                              icon="chevron-up"
                              accessibilityLabel={t('videoPlayer.customizeMoveUp', { name })}
                              disabled={index === 0}
                              onPress={() => move(group, id, -1)}
                              testID={`player-customize-${group}-${id}-up`}
                            />
                            <MoveButton
                              icon="chevron-down"
                              accessibilityLabel={t('videoPlayer.customizeMoveDown', { name })}
                              disabled={index === entries.length - 1}
                              onPress={() => move(group, id, 1)}
                              testID={`player-customize-${group}-${id}-down`}
                            />
                          </>
                        ) : null}
                        <DsToggle
                          value={shown}
                          onValueChange={(next) => show(group, id, next)}
                          accessibilityLabel={t('videoPlayer.customizeShow', { name })}
                          testID={`player-customize-${group}-${id}-shown`}
                        />
                      </View>
                    }
                  />
                );
              })}
            </DsRowGroup>
          </Fragment>
        );
      })}
      <DsButton
        label={t('videoPlayer.customizeReset')}
        variant="secondary"
        fullWidth
        onPress={reset}
        testID="player-customize-controls-reset"
      />
    </PlayerSheetFrame>
  );
});

const styles = StyleSheet.create({
  trailing: {
    alignItems: 'center',
    gap: 2,
  },
  moveButton: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
