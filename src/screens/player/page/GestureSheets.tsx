import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import {
  DsButton,
  DsCard,
  DsChip,
  DsChipRow,
  DsIcon,
  DsRow,
  DsRowGroup,
  DsSectionLabel,
  DsText,
  type DsIconName,
} from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import {
  GESTURE_SENSITIVITIES,
  SWITCHABLE_GESTURES,
  type GestureSensitivity,
  type GestureSettings,
  type SwitchableGesture,
} from '@/player/gesture-settings';
import { GESTURE_SENSITIVITY_LABELS } from '@/player/gesture-settings-labels';

import { PlayerSheetFrame } from './PlayerSheetFrame';

const GESTURE_ROWS: Readonly<Record<SwitchableGesture, { label: TranslationKey; hint?: TranslationKey; icon: DsIconName }>> = {
  swipeSeek: { label: 'videoPlayer.gestureSwipeSeek', hint: 'videoPlayer.gestureSwipeSeekHint', icon: 'arrow-right' },
  brightness: { label: 'videoPlayer.gestureBrightness', icon: 'sun' },
  volume: { label: 'videoPlayer.gestureVolume', icon: 'volume-2' },
  doubleTap: { label: 'videoPlayer.gestureDoubleTap', icon: 'skip-forward' },
  longPress: { label: 'videoPlayer.gestureLongPress', icon: 'fast-forward' },
  twoFingerTap: { label: 'videoPlayer.gestureTwoFingerTap', icon: 'pause' },
  pinchZoom: { label: 'videoPlayer.gesturePinchZoom', icon: 'scan' },
};

/** Screen 20's picture: brightness on the left edge, seek either way, volume on the right edge (physical sides). */
const MAP_ICONS: readonly DsIconName[] = ['sun', 'arrow-left', 'arrow-right', 'volume-2'];

export type GesturesSheetProps = {
  visible: boolean;
  settings: GestureSettings;
  onSetEnabled: (on: boolean) => void;
  onSetGesture: (gesture: SwitchableGesture, on: boolean) => void;
  onSetSensitivity: (sensitivity: GestureSensitivity) => void;
  onReset: () => void;
  onClose: () => void;
};

/**
 * P8 Gestures, as the design's screen 20 card: what each gesture does, the master switch (#587 "Gesture controls"),
 * the sensitivity (#586) and one switch per gesture (#587). Every change applies at once and is remembered app-wide.
 * The per-gesture switches stay as set (greyed) while the master switch is off.
 */
export const GesturesSheet = memo(function GesturesSheet({
  visible,
  settings,
  onSetEnabled,
  onSetGesture,
  onSetSensitivity,
  onReset,
  onClose,
}: GesturesSheetProps) {
  const { t } = useTranslation();
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('videoPlayer.gestures')}
      subtitle={t('videoPlayer.gesturesSheetSubtitle')}
      onClose={onClose}
      testID="player-gestures-sheet">
      <DsCard testID="player-gestures-map">
        <View style={styles.mapIcons} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {MAP_ICONS.map((icon) => (
            <DsIcon key={icon} name={icon} size={20} color="textPrimary" />
          ))}
        </View>
        <DsText variant="rowSub" align="center">
          {t('videoPlayer.gestureMapEdges')}
        </DsText>
        <DsText variant="rowSub" align="center">
          {t('videoPlayer.gestureMapMiddle')}
        </DsText>
        <DsText variant="rowSub" align="center">
          {t('videoPlayer.gestureMapHold')}
        </DsText>
      </DsCard>

      <DsRowGroup>
        <DsRow
          icon="circle-dot"
          title={t('videoPlayer.gestureControls')}
          subtitle={t('videoPlayer.gestureControlsHint')}
          toggle={{ value: settings.enabled, onValueChange: onSetEnabled, accessibilityHint: t('videoPlayer.gestureControlsHint') }}
          testID="player-gestures-master"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('videoPlayer.gestureSensitivity')}</DsSectionLabel>
      <DsChipRow scroll={false} testID="player-gestures-sensitivity">
        {GESTURE_SENSITIVITIES.map((sensitivity) => (
          <DsChip
            key={sensitivity}
            label={t(GESTURE_SENSITIVITY_LABELS[sensitivity])}
            selected={settings.sensitivity === sensitivity}
            onPress={() => onSetSensitivity(sensitivity)}
            testID={`player-gestures-sensitivity-${sensitivity}`}
          />
        ))}
      </DsChipRow>
      <DsText variant="rowSub">{t('videoPlayer.gestureSensitivityNote')}</DsText>

      <DsSectionLabel>{t('videoPlayer.gestureEach')}</DsSectionLabel>
      <DsRowGroup testID="player-gestures-each">
        {SWITCHABLE_GESTURES.map((gesture) => {
          const row = GESTURE_ROWS[gesture];
          return (
            <DsRow
              key={gesture}
              icon={row.icon}
              title={t(row.label)}
              subtitle={row.hint ? t(row.hint) : undefined}
              toggle={{ value: settings[gesture], onValueChange: (on) => onSetGesture(gesture, on) }}
              disabled={!settings.enabled}
              testID={`player-gesture-${gesture}`}
            />
          );
        })}
      </DsRowGroup>
      <DsText variant="rowSub">{t('videoPlayer.gesturesTapNote')}</DsText>
      <DsButton label={t('videoPlayer.gesturesReset')} variant="secondary" fullWidth onPress={onReset} testID="player-gestures-reset" />
    </PlayerSheetFrame>
  );
});

export type GestureSensitivitySheetProps = {
  visible: boolean;
  selected: GestureSensitivity;
  onSelect: (sensitivity: GestureSensitivity) => void;
  onClose: () => void;
};

/** P8 #586: Low, Normal or High, for the swipe seek, the brightness and the volume (from the options sheet's row). */
export const GestureSensitivitySheet = memo(function GestureSensitivitySheet({
  visible,
  selected,
  onSelect,
  onClose,
}: GestureSensitivitySheetProps) {
  const { t } = useTranslation();
  const actions = useMemo<ActionSheetItem[]>(
    () =>
      GESTURE_SENSITIVITIES.map((sensitivity) => ({
        id: `gesture-sensitivity-${sensitivity}`,
        label: t(GESTURE_SENSITIVITY_LABELS[sensitivity]),
        selected: sensitivity === selected,
        onPress: () => onSelect(sensitivity),
      })),
    [onSelect, selected, t],
  );
  return (
    <ActionSheetModal
      visible={visible}
      title={t('videoPlayer.gestureSensitivity')}
      subtitle={t('videoPlayer.gestureSensitivitySubtitle')}
      actions={actions}
      onClose={onClose}
      testID="player-gesture-sensitivity-sheet"
    />
  );
});

const styles = StyleSheet.create({
  // Physical left → right on purpose (brightness is the left edge in every language), so never row-reverse.
  mapIcons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    paddingBottom: 8,
  },
});
