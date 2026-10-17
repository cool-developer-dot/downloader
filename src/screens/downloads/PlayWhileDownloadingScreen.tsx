import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useEffect, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Loader } from '@/components/common/Loader';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { fileIntegrity, playableUri } from '@/downloads/v2/file-integrity';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

const Surface = memo(function Surface({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (created) => {
    created.play();
  });
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }}
      testID="play-while-downloading-video"
    />
  );
});

/**
 * H20 Play While Downloading (#411): a simple player for a download that is not finished. It reads the download's
 * growing file through VidoraX's own content provider — what is downloaded so far, waiting at its end for more — and
 * keeps no watch history or resume position (the file is not in the library yet). The session ends when this closes.
 */
export const PlayWhileDownloadingScreen = memo(function PlayWhileDownloadingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : null;
  const title = useDownloadsStore((state) => (id ? state.itemsById[id]?.title ?? state.engineRowsById[id]?.title : null));
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const port = fileIntegrity();
    let alive = true;
    let opened: string | null = null;
    void (async () => {
      const source = id && port?.getPlayableSource ? await port.getPlayableSource(id).catch(() => null) : null;
      const next = playableUri(source);
      if (!alive) {
        if (next) port?.releasePlayableSource?.(next);
        return;
      }
      if (!next) {
        setFailed(true);
        return;
      }
      opened = next;
      setUri(next);
    })();
    return () => {
      alive = false;
      if (opened) port?.releasePlayableSource?.(opened);
    };
  }, [id]);

  return (
    <SafeAreaScreen
      testID="play-while-downloading-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader title={title?.trim() || t('fileIntegrity.playWhileDownloading')} showBack />
      <Box gap={12} p={16}>
        {uri ? <Surface uri={uri} /> : failed ? null : <Loader />}
        <Text variant="bodySmall" color="textSecondary" accessibilityLiveRegion="polite">
          {failed ? t('fileIntegrity.playUnavailable') : t('fileIntegrity.playWhileDownloadingNote')}
        </Text>
      </Box>
    </SafeAreaScreen>
  );
});
