import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import {
  DsButton,
  DsButtonRow,
  DsHeader,
  DsRow,
  DsRowGroup,
  DsScreen,
  DsSearchField,
  DsText,
  ds,
} from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { parseNetworkStreamLink, type NetworkStreamLink, type NetworkStreamRefusal } from '@/player/engine/network-stream';
import { openNetworkStream } from '@/player/engine/network-stream.runtime';
import { requestStreamDownload } from '@/player/engine/stream-download-handoff';
import { STREAM_QUALITIES, setStreamQuality, useStreamQuality, type StreamQuality } from '@/player/engine/stream-quality';
import { streamCapLabel } from '@/player/engine/use-player-engine';
import { EngineChoiceSheet, type EngineChoice } from '@/screens/player/engine/EngineChoiceSheet';

type LinkError = Exclude<NetworkStreamLink, { ok: true }>['reason'] | NetworkStreamRefusal;

const ERROR_KEYS: Record<LinkError, TranslationKey> = {
  empty: 'playerEngine.streamErrorEmpty',
  invalid: 'playerEngine.streamErrorInvalid',
  not_http: 'playerEngine.streamErrorNotHttp',
  youtube: 'playerEngine.streamErrorYoutube',
  drm: 'playerEngine.streamErrorDrm',
  blocked: 'playerEngine.streamErrorBlocked',
  not_media: 'playerEngine.streamErrorNotMedia',
  not_found: 'playerEngine.streamErrorNotFound',
  http: 'playerEngine.streamErrorHttp',
  network: 'playerEngine.streamErrorNetwork',
  unsupported: 'playerEngine.streamErrorUnsupported',
};

/**
 * Screen 52, "Open stream" (P14): play a video link from the web without downloading it (#663), or hand it to the
 * downloader instead (#672), and the stream quality cap (#670). The link is never saved: it lives in this screen and,
 * once playing, in memory for the Player (no history, no library row).
 */
export const NetworkStreamScreen = memo(function NetworkStreamScreen() {
  const { t } = useTranslation();
  const quality = useStreamQuality();
  const [link, setLink] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<LinkError | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);

  const fail = useCallback(
    (reason: LinkError) => {
      setError(reason);
      AccessibilityInfo.announceForAccessibility(t(ERROR_KEYS[reason]));
    },
    [t],
  );

  const changeLink = useCallback((text: string) => {
    setLink(text);
    setError(null);
  }, []);

  const play = useCallback(async () => {
    if (checking) {
      return;
    }
    const parsed = parseNetworkStreamLink(link);
    if (!parsed.ok) {
      fail(parsed.reason);
      return;
    }
    setChecking(true);
    setError(null);
    AccessibilityInfo.announceForAccessibility(t('playerEngine.streamChecking'));
    try {
      const plan = await openNetworkStream(parsed.url);
      if (!plan.ok) {
        fail(plan.reason);
      }
    } finally {
      setChecking(false);
    }
  }, [checking, fail, link, t]);

  const paste = useCallback(async () => {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (text) {
        changeLink(text);
        return;
      }
    } catch {
      // Falls through to the message.
    }
    AccessibilityInfo.announceForAccessibility(t('playerEngine.streamClipboardEmpty'));
    setError(null);
  }, [changeLink, t]);

  const downloadInstead = useCallback(() => {
    const parsed = parseNetworkStreamLink(link);
    if (!parsed.ok) {
      fail(parsed.reason);
      return;
    }
    requestStreamDownload({ url: parsed.url, referer: null });
    router.dismissTo(routePaths.downloads as Parameters<typeof router.dismissTo>[0]);
  }, [fail, link]);

  const qualityChoices = useMemo<EngineChoice<StreamQuality>[]>(
    () =>
      STREAM_QUALITIES.map((value) => ({
        value,
        label: streamCapLabel(t, value),
        subtitle:
          value === 'auto'
            ? t('playerEngine.streamQualityAutoSub')
            : value === 'saver'
              ? t('playerEngine.streamQualitySaverSub')
              : undefined,
      })),
    [t],
  );

  const selectQuality = useCallback((value: StreamQuality) => {
    setStreamQuality(value);
    setQualityOpen(false);
  }, []);

  return (
    <DsScreen testID="network-stream-screen">
      <DsHeader
        title={t('playerEngine.streamTitle')}
        subtitle={t('playerEngine.streamSubtitle')}
        onBack={() => navigation.back()}
        testID="network-stream-header"
      />
      <DsSearchField
        icon="link"
        value={link}
        onChangeText={changeLink}
        placeholder={t('playerEngine.streamPlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={() => void play()}
        accessibilityLabel={t('playerEngine.streamLinkA11y')}
        actions={link ? [{ icon: 'x', accessibilityLabel: t('common.clearInput'), onPress: () => changeLink('') }] : undefined}
        testID="network-stream-link"
      />
      {error ? (
        <View style={styles.message} accessibilityLiveRegion="polite">
          <DsText variant="rowSub" color="error" testID="network-stream-error">
            {t(ERROR_KEYS[error])}
          </DsText>
        </View>
      ) : null}
      <DsButtonRow>
        <DsButton
          label={t('playerEngine.streamPaste')}
          variant="secondary"
          icon="clipboard"
          flex
          onPress={() => void paste()}
          testID="network-stream-paste"
        />
        <DsButton
          label={checking ? t('playerEngine.streamChecking') : t('playerEngine.streamPlay')}
          icon="play"
          flex
          disabled={checking}
          onPress={() => void play()}
          testID="network-stream-play"
        />
      </DsButtonRow>
      <DsRowGroup testID="network-stream-rows">
        <DsRow
          icon="download"
          title={t('playerEngine.streamDownloadInstead')}
          subtitle={t('playerEngine.streamDownloadInsteadSub')}
          onPress={downloadInstead}
          testID="network-stream-download"
        />
        <DsRow
          icon="gauge"
          title={t('playerEngine.streamQuality')}
          subtitle={t('playerEngine.streamQualitySubtitle')}
          value={streamCapLabel(t, quality)}
          onPress={() => setQualityOpen(true)}
          testID="network-stream-quality"
        />
      </DsRowGroup>
      <View style={styles.message}>
        <DsText variant="rowSub" testID="network-stream-formats">
          {t('playerEngine.streamFormats')}
        </DsText>
      </View>
      <EngineChoiceSheet
        visible={qualityOpen}
        title={t('playerEngine.streamQuality')}
        subtitle={t('playerEngine.streamQualitySubtitle')}
        choices={qualityChoices}
        selected={quality}
        onSelect={selectQuality}
        onClose={() => setQualityOpen(false)}
        testID="network-stream-quality-sheet"
      />
    </DsScreen>
  );
});

const styles = StyleSheet.create({
  message: {
    paddingHorizontal: ds.space.screenX,
    paddingVertical: 8,
  },
});
