import { memo } from 'react';

import { DsIcon, DsRow, DsRowGroup, DsSectionLabel } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import {
  VOLUME_KEY_MODES,
  setHeadsetKeySettings,
  useHeadsetKeySettings,
  type VolumeKeysMode,
} from '@/player/engine/headset-keys';

import { PlayerSheetFrame } from '../page/PlayerSheetFrame';

const VOLUME_LABELS: Record<VolumeKeysMode, { title: TranslationKey; sub: TranslationKey }> = {
  player: { title: 'playerEngine.keysVolumePlayer', sub: 'playerEngine.keysVolumePlayerSub' },
  seek: { title: 'playerEngine.keysVolumeSeek', sub: 'playerEngine.keysVolumeSeekSub' },
  system: { title: 'playerEngine.keysVolumeSystem', sub: 'playerEngine.keysVolumeSystemSub' },
};

export type HeadsetKeysSheetProps = { visible: boolean; onClose: () => void };

/** P15: Headset, keys & lock screen — #560, #661, #562, #701, #703 (app-wide; changes apply at once). */
export const HeadsetKeysSheet = memo(function HeadsetKeysSheet({ visible, onClose }: HeadsetKeysSheetProps) {
  const { t } = useTranslation();
  const settings = useHeadsetKeySettings();
  const toggle = (key: 'pauseOnUnplug' | 'headsetButtons' | 'remoteKeys' | 'showOnLockScreen', label: TranslationKey) => ({
    value: settings[key],
    onValueChange: (next: boolean) => setHeadsetKeySettings({ [key]: next }),
    accessibilityLabel: t(label),
  });
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('playerEngine.keysTitle')}
      subtitle={t('playerEngine.keysSubtitle')}
      onClose={onClose}
      testID="player-headset-keys-sheet">
      <DsRowGroup>
        <DsRow
          icon="volume-x"
          title={t('playerEngine.keysUnplug')}
          subtitle={t('playerEngine.keysUnplugSub')}
          toggle={toggle('pauseOnUnplug', 'playerEngine.keysUnplug')}
          testID="player-keys-unplug"
        />
        <DsRow
          icon="skip-forward"
          title={t('playerEngine.keysHeadset')}
          subtitle={t('playerEngine.keysHeadsetSub')}
          toggle={toggle('headsetButtons', 'playerEngine.keysHeadset')}
          testID="player-keys-headset"
        />
        <DsRow
          icon="keyboard"
          title={t('playerEngine.keysRemote')}
          subtitle={t('playerEngine.keysRemoteSub')}
          toggle={toggle('remoteKeys', 'playerEngine.keysRemote')}
          testID="player-keys-remote"
        />
        <DsRow
          icon="lock"
          title={t('playerEngine.keysLockScreen')}
          subtitle={t('playerEngine.keysLockScreenSub')}
          toggle={toggle('showOnLockScreen', 'playerEngine.keysLockScreen')}
          testID="player-keys-lock-screen"
        />
      </DsRowGroup>
      <DsSectionLabel>{t('playerEngine.keysVolume')}</DsSectionLabel>
      <DsRowGroup>
        {VOLUME_KEY_MODES.map((mode) => {
          const selected = settings.volumeKeys === mode;
          const title = t(VOLUME_LABELS[mode].title);
          const sub = t(VOLUME_LABELS[mode].sub);
          return (
            <DsRow
              key={mode}
              icon="volume-2"
              title={title}
              subtitle={sub}
              onPress={() => setHeadsetKeySettings({ volumeKeys: mode })}
              trailing={selected ? <DsIcon name="check" size={20} /> : 'none'}
              accessibilityLabel={selected ? `${title}, ${sub}, ${t('common.selected')}` : `${title}, ${sub}`}
              testID={`player-keys-volume-${mode}`}
            />
          );
        })}
      </DsRowGroup>
    </PlayerSheetFrame>
  );
});
