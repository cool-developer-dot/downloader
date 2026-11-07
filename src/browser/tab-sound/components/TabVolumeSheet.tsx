import { memo, useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { IconButton } from '@/components/buttons/IconButton';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTranslation } from '@/localization';

import { tabAudio } from '../tab-audio.service';
import { PercentSlider } from './PercentSlider';

/** B3 #220 / #8 — one tab's volume (0–100 %) and mute, applied in its page at once. */
export const TabVolumeSheet = memo(function TabVolumeSheet({
  tabId,
  title,
  onClose,
}: {
  /** null = hidden. */
  tabId: string | null;
  title: string;
  onClose: () => void;
}) {
  const { t, rtl } = useTranslation();
  useSyncExternalStore(tabAudio.subscribe, tabAudio.getVersion, tabAudio.getVersion);
  const state = tabId ? tabAudio.get(tabId) : null;

  return (
    <SheetFrame
      visible={tabId != null}
      title={t('browserTabSound.volumeTitle')}
      onClose={onClose}
      testID="tab-volume-sheet"
      footer={<Button title={t('browserTabSound.done')} onPress={onClose} testID="tab-volume-done" />}>
      {tabId && state ? (
        <View style={{ gap: 8 }}>
          <Text variant="body" numberOfLines={2}>
            {title}
          </Text>
          <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 4 }}>
            <IconButton
              icon={state.muted ? 'volume-off' : 'volume-high'}
              size="large"
              variant="ghost"
              accessibilityLabel={state.muted ? t('browserTabSound.unmute') : t('browserTabSound.mute')}
              onPress={() => tabAudio.setMuted(tabId, !state.muted)}
              testID="tab-volume-mute"
            />
            <IconButton
              icon="minus"
              size="large"
              variant="ghost"
              accessibilityLabel={t('browserTabSound.volumeLower')}
              disabled={state.volume <= 0}
              onPress={() => tabAudio.setVolume(tabId, state.volume - 10)}
              testID="tab-volume-lower"
            />
            <View style={{ flex: 1 }}>
              <PercentSlider
                value={state.volume}
                onChange={(value) => tabAudio.setVolume(tabId, value)}
                accessibilityLabel={t('browserTabSound.volume')}
                testID="tab-volume-slider"
              />
            </View>
            <IconButton
              icon="plus"
              size="large"
              variant="ghost"
              accessibilityLabel={t('browserTabSound.volumeRaise')}
              disabled={state.volume >= 100}
              onPress={() => tabAudio.setVolume(tabId, state.volume + 10)}
              testID="tab-volume-raise"
            />
          </View>
          <Text variant="label" style={{ textAlign: 'center' }}>
            {state.muted ? t('browserTabSound.muted') : t('browserTabSound.volumePercent', { percent: state.volume })}
          </Text>
          <Text variant="caption" color="textSecondary">
            {t('browserTabSound.volumeHint')}
          </Text>
        </View>
      ) : null}
    </SheetFrame>
  );
});
