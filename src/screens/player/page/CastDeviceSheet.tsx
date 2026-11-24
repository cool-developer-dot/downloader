import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CastDevice } from '@modules/vidorax-media/src/VidoraCast.types';

import { DsIconButton, DsRow, DsRowGroup, DsText } from '@/design';
import { useTranslation } from '@/localization';
import type { CastConnection } from '@/player/cast/cast-store';

import { CAST_VOLUME_STEP } from './use-player-cast';
import { PlayerSheetFrame } from './PlayerSheetFrame';

export type CastDeviceSheetProps = {
  visible: boolean;
  devices: readonly CastDevice[];
  connection: CastConnection;
  deviceName: string | null;
  volume: number | null;
  onPick: (deviceId: string) => void;
  onStop: () => void;
  onVolume: (delta: number) => void;
  onClose: () => void;
};

/**
 * P13 #667: the Cast button's sheet. Not casting: the Cast devices on this Wi-Fi. Casting: the device, the TV's volume
 * and Stop casting. The Player's sheet frame and design-kit rows, so it follows the six themes and Urdu (RTL rows).
 */
export const CastDeviceSheet = memo(function CastDeviceSheet({
  visible,
  devices,
  connection,
  deviceName,
  volume,
  onPick,
  onStop,
  onVolume,
  onClose,
}: CastDeviceSheetProps) {
  const { t } = useTranslation();
  const name = deviceName || t('playerCast.thisDevice');
  const connected = connection === 'connected';
  const percent = volume != null ? `${Math.round(volume * 100)}%` : undefined;

  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('playerCast.sheetTitle')}
      subtitle={connected ? t('playerCast.connectedHint') : t('playerCast.sheetSubtitle')}
      onClose={onClose}
      testID="player-cast-sheet">
      {connected ? (
        <DsRowGroup testID="player-cast-connected">
          <DsRow icon="cast" title={t('playerCast.castingTo', { device: name })} subtitle={t('playerCast.stopCastingHint')} />
          <DsRow
            icon="volume-2"
            title={t('playerCast.volume')}
            value={percent}
            trailing={
              <View style={styles.volume}>
                <DsIconButton
                  icon="minus"
                  accessibilityLabel={t('playerCast.volumeDown')}
                  onPress={() => onVolume(-CAST_VOLUME_STEP)}
                  testID="player-cast-volume-down"
                />
                <DsIconButton
                  icon="plus"
                  accessibilityLabel={t('playerCast.volumeUp')}
                  onPress={() => onVolume(CAST_VOLUME_STEP)}
                  testID="player-cast-volume-up"
                />
              </View>
            }
          />
          <DsRow icon="x" title={t('playerCast.stopCasting')} destructive onPress={onStop} testID="player-cast-stop" />
        </DsRowGroup>
      ) : devices.length === 0 ? (
        <DsText variant="rowSub" testID="player-cast-empty">
          {connection === 'connecting' ? t('playerCast.connectingNoName') : t('playerCast.sheetEmpty')}
        </DsText>
      ) : (
        <DsRowGroup testID="player-cast-devices">
          {devices.map((device) => (
            <DsRow
              key={device.id}
              icon="tv"
              title={device.name}
              subtitle={device.description ?? undefined}
              disabled={connection === 'connecting'}
              onPress={() => onPick(device.id)}
              accessibilityLabel={t('playerCast.deviceA11y', { device: device.name })}
              testID={`player-cast-device-${device.id}`}
            />
          ))}
        </DsRowGroup>
      )}
    </PlayerSheetFrame>
  );
});

const styles = StyleSheet.create({
  volume: {
    flexDirection: 'row',
    gap: 4,
  },
});
