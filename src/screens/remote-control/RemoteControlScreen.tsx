import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, ToastAndroid, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { DsHeader, DsScreen } from '@/design';
import { Switch } from '@/components/inputs/Switch';
import { qrPath, qrRows } from '@/browser/share-qr/qr-code';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import {
  clearSentToComputer,
  forgetAllRemoteClients,
  forgetRemoteClient,
  newRemotePin,
  refreshRemoteState,
  removeSentToComputer,
  startRemoteControl,
  stopRemoteControl,
  useRemoteStore,
} from '@/remote/remote-control';
import {
  formatPin,
  lockSecondsLeft,
  remoteQrText,
  startErrorKey,
  stopReasonKey,
} from '@/remote/remote-presentation';
import { SettingsRow, SettingsSection } from '@/screens/settings/components';

function announce(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/** P6 Settings → Downloads → Remote control: the local Web UI's switch, address, PIN/QR and paired browsers. */
export const RemoteControlScreen = memo(function RemoteControlScreen() {
  const { t, language, rtl } = useTranslation();
  const status = useRemoteStore((state) => state.status);
  const sent = useRemoteStore((state) => state.sent);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void refreshRemoteState().catch(() => undefined);
  }, []);

  // A PIN lock counts down on screen.
  useEffect(() => {
    if (!status.lockedUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status.lockedUntil]);

  const toggle = useCallback(async (on: boolean) => {
    setBusy(true);
    setStartError(null);
    try {
      if (on) await startRemoteControl();
      else await stopRemoteControl();
    } catch (error) {
      setStartError(startErrorKey((error as { code?: string } | null)?.code));
    } finally {
      setBusy(false);
    }
  }, []);

  const copyAddress = useCallback(async () => {
    if (!status.url) return;
    await Clipboard.setStringAsync(status.url);
    announce(t('remoteControl.addressCopied'));
  }, [status.url, t]);

  const confirmForgetAll = useCallback(() => {
    Alert.alert(t('remoteControl.forgetAllTitle'), t('remoteControl.forgetAllMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('remoteControl.forgetAll'), style: 'destructive', onPress: () => void forgetAllRemoteClients() },
    ]);
  }, [t]);

  const qr = useMemo(() => {
    const text = remoteQrText(status);
    const rows = text ? qrRows(text) : null;
    return rows ? { path: qrPath(rows), size: rows.length + 8 } : null;
  }, [status]);

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  );

  const stopped = stopReasonKey(status);
  const lockSeconds = lockSecondsLeft(status, now);

  return (
    <DsScreen testID="remote-control-screen" edges={['top', 'bottom']}>
      <DsHeader title={t('remoteControl.title')} onBack={() => navigation.back()} testID="remote-control-header" />

      <Text variant="bodySmall" color="textSecondary">
        {t('remoteControl.intro')}
      </Text>

      <SettingsSection title={t('remoteControl.title')} icon="monitor-cellphone" testID="remote-control-main">
        <SettingsRow
          title={t('remoteControl.switchLabel')}
          description={t('remoteControl.switchHint')}
          icon="access-point"
          trailing={
            <Switch
              value={status.running}
              onValueChange={(value) => void toggle(value)}
              disabled={busy}
              accessibilityLabel={t('remoteControl.switchLabel')}
              accessibilityHint={t('remoteControl.switchHint')}
              testID="remote-control-switch"
            />
          }
          showDivider={false}
          testID="remote-control-row"
        />
        {startError ? (
          <Text variant="caption" color="error" testID="remote-control-error">
            {t(startError as Parameters<typeof t>[0])}
          </Text>
        ) : null}
        {stopped ? (
          <Text variant="caption" color="textSecondary" testID="remote-control-stopped">
            {t(stopped)}
          </Text>
        ) : null}
      </SettingsSection>

      {status.running && status.url ? (
        <SettingsSection title={t('remoteControl.openOnComputer')} icon="laptop" testID="remote-control-address">
          <Box gap={12} py={8}>
            <Text variant="h3" selectable style={{ writingDirection: 'ltr', textAlign: rtl.isRtl ? 'right' : 'left' }} testID="remote-control-url">
              {status.url}
            </Text>
            <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }}>
              <Button title={t('remoteControl.copyAddress')} variant="outline" size="small" onPress={() => void copyAddress()} testID="remote-control-copy" />
            </Box>
            <Text variant="label">{t('remoteControl.pinTitle')}</Text>
            {status.pin ? (
              <Text
                variant="display"
                accessibilityLabel={t('remoteControl.pinA11y', { pin: status.pin.split('').join(' ') })}
                style={{ writingDirection: 'ltr', letterSpacing: 4, textAlign: rtl.isRtl ? 'right' : 'left' }}
                testID="remote-control-pin">
                {formatPin(status.pin)}
              </Text>
            ) : null}
            {lockSeconds > 0 ? (
              <Text variant="caption" color="error">
                {t('remoteControl.locked', { seconds: lockSeconds })}
              </Text>
            ) : null}
            {status.pinWithdrawn ? (
              <Text variant="caption" color="error">
                {t('remoteControl.pinWithdrawn')}
              </Text>
            ) : null}
            <Text variant="caption" color="textSecondary">
              {t('remoteControl.pinHint')}
            </Text>
            {qr ? (
              <View style={{ alignItems: 'center' }}>
                {/* Always dark on white, whatever the theme, so every scanner reads it. */}
                <View
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={t('remoteControl.qrA11y')}
                  style={{ backgroundColor: '#FFFFFF', padding: 4, borderRadius: 8 }}
                  testID="remote-control-qr">
                  <Svg width={200} height={200} viewBox={`0 0 ${qr.size} ${qr.size}`}>
                    <Rect x={0} y={0} width={qr.size} height={qr.size} fill="#FFFFFF" />
                    <Path d={qr.path} fill="#000000" />
                  </Svg>
                </View>
              </View>
            ) : null}
            <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }}>
              <Button title={t('remoteControl.newPin')} variant="outline" size="small" onPress={() => void newRemotePin()} testID="remote-control-new-pin" />
            </Box>
          </Box>
        </SettingsSection>
      ) : null}

      <SettingsSection title={t('remoteControl.pairedTitle')} icon="devices" testID="remote-control-clients">
        {status.clients.length === 0 ? (
          <Text variant="caption" color="textSecondary" style={{ paddingVertical: 8 }}>
            {t('remoteControl.pairedEmpty')}
          </Text>
        ) : (
          status.clients.map((client, index) => (
            <SettingsRow
              key={client.id}
              title={client.name}
              description={t('remoteControl.pairedLastSeen', { date: dateFormat.format(new Date(client.lastSeenAt)) })}
              icon="web"
              trailing={
                <Button
                  title={t('remoteControl.forget')}
                  variant="text"
                  size="small"
                  onPress={() => void forgetRemoteClient(client.id)}
                  accessibilityLabel={t('remoteControl.forgetA11y', { name: client.name })}
                  testID={`remote-control-forget-${index}`}
                />
              }
              showDivider={index < status.clients.length - 1}
            />
          ))
        )}
        {status.clients.length > 1 ? (
          <Button title={t('remoteControl.forgetAll')} variant="text" size="small" onPress={confirmForgetAll} testID="remote-control-forget-all" />
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={t('remoteControl.sentTitle')}
        description={t('remoteControl.sentHint')}
        icon="send-outline"
        testID="remote-control-sent">
        {sent.length === 0 ? (
          <Text variant="caption" color="textSecondary" style={{ paddingVertical: 8 }}>
            {t('remoteControl.sentEmpty')}
          </Text>
        ) : (
          sent.map((item, index) => (
            <SettingsRow
              key={item.id}
              title={item.title}
              description={t(item.hasFile ? 'remoteControl.sentFile' : 'remoteControl.sentLink')}
              icon={item.hasFile ? 'file-video-outline' : 'link-variant'}
              trailing={
                <Button
                  title={t('common.remove')}
                  variant="text"
                  size="small"
                  onPress={() => void removeSentToComputer(item.id)}
                  accessibilityLabel={t('remoteControl.removeSentA11y', { title: item.title })}
                  testID={`remote-control-sent-remove-${index}`}
                />
              }
              showDivider={index < sent.length - 1}
            />
          ))
        )}
        {sent.length > 1 ? (
          <Button title={t('remoteControl.clearSent')} variant="text" size="small" onPress={() => void clearSentToComputer()} testID="remote-control-sent-clear" />
        ) : null}
      </SettingsSection>

      <SettingsSection title={t('remoteControl.toolsTitle')} icon="puzzle-outline" testID="remote-control-tools">
        <Text variant="caption" color="textSecondary" style={{ paddingVertical: 8 }}>
          {t('remoteControl.toolsHint')}
        </Text>
      </SettingsSection>
    </DsScreen>
  );
});
