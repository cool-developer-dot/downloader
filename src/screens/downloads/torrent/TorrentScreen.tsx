import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { DsCard, DsChip, DsChipRow, DsHeader, DsIcon, DsProgressBar, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useNotAvailableYet } from '@/screens/settings/download-settings/light/useNotAvailableYet';

/**
 * Design 14 "Torrent". VidoraX has no torrent engine: this is the module's torrent screen with no data — the
 * frame's card, chips and rows exactly as drawn, every value "—" and every control saying it is not available yet.
 */
export const TorrentScreen = memo(function TorrentScreen() {
  const { t, rtl } = useTranslation();
  const notYet = useNotAvailableYet();
  const goBack = useCallback(() => navigation.back(), []);
  const openSettings = useCallback(() => navigation.push(routePaths.downloadSettings), []);
  const noop = useCallback(() => notYet(), [notYet]);

  return (
    <DsScreen testID="downloads-torrent-screen">
      <DsHeader
        title={t('lightTorrent.title')}
        subtitle={t('lightTorrent.noTorrent')}
        onBack={goBack}
        action={{ icon: 'settings', accessibilityLabel: t('lightDetails.settingsA11y'), onPress: openSettings }}
      />
      <DsCard testID="downloads-torrent-card">
        <DsProgressBar progress={0} accessibilityLabel={t('lightTorrent.progressA11y')} />
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6 }}>
            <DsIcon name="download" size={16} color="textSecondary" accessibilityLabel={t('lightTorrent.downA11y')} />
            <DsText variant="rowSub">{t('lightTorrent.none')}</DsText>
          </View>
          <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6 }}>
            <DsIcon name="upload" size={16} color="textSecondary" accessibilityLabel={t('lightTorrent.upA11y')} />
            <DsText variant="rowSub">{`${t('lightTorrent.none')} · ${t('lightTorrent.ratio', { ratio: t('lightTorrent.none') })}`}</DsText>
          </View>
        </View>
      </DsCard>
      <DsChipRow>
        <DsChip label={t('lightTorrent.files')} onPress={notYet} />
        <DsChip label={t('lightTorrent.peers')} selected onPress={notYet} />
        <DsChip label={t('lightTorrent.trackers')} onPress={notYet} />
        <DsChip label={t('lightTorrent.info')} onPress={notYet} />
      </DsChipRow>
      <DsRowGroup>
        <DsRow icon="users" title={t('lightTorrent.seedsLeechers')} subtitle={t('lightTorrent.seedsValue')} onPress={notYet} testID="downloads-torrent-seeds" />
        <DsRow icon="globe" title={t('lightTorrent.dhtPortIpFilter')} onPress={notYet} testID="downloads-torrent-dht" />
        <DsRow icon="lock" title={t('lightTorrent.protocolEncryption')} toggle={{ value: false, onValueChange: noop }} testID="downloads-torrent-encryption" />
        <DsRow icon="shield" title={t('lightTorrent.bindToVpn')} toggle={{ value: false, onValueChange: noop }} testID="downloads-torrent-vpn" />
        <DsRow icon="link" title={t('lightTorrent.sequentialDownload')} toggle={{ value: false, onValueChange: noop }} testID="downloads-torrent-sequential" />
        <DsRow icon="upload" title={t('lightTorrent.uploadLimit')} onPress={notYet} testID="downloads-torrent-upload" />
      </DsRowGroup>
    </DsScreen>
  );
});
