import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { MAX_WATCHED_LINKS, normalizeWatchUrl } from '@/downloads/watch/watch-core';
import { getWatchPort } from '@/downloads/watch/watch-port';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { WATCHED_LINKS_ROUTE } from '@/screens/watched-links/route';

/**
 * Download details → "Watch for updates" (#504 Update Detection): watches the finished video's source page (weekly)
 * and notifies when what it offers changes. Hidden without a web source or on a build without watched links.
 */
export const DownloadWatchAction = memo(function DownloadWatchAction({ sourceUrl }: { sourceUrl: string | null | undefined }) {
  const { t } = useTranslation();
  const port = useMemo(() => getWatchPort(), []);
  const url = sourceUrl ? normalizeWatchUrl(sourceUrl) : null;
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!port || !url) return;
    let alive = true;
    void port
      .list()
      .then((links) => alive && setWatching(links.some((l) => l.url === url)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [port, url]);

  const watch = useCallback(async () => {
    if (!port || !url) return;
    setBusy(true);
    const result = await port.add(url, { intervalHours: 168, autoDownload: false }).catch(() => null);
    setBusy(false);
    if (result?.ok) {
      setWatching(true);
      setMessage(null);
    } else {
      setMessage(result?.reason === 'full' ? t('watchedLinks.full', { count: MAX_WATCHED_LINKS }) : t('watchedLinks.unreachable'));
    }
  }, [port, t, url]);

  if (!port || !url) return null;
  return (
    <Box mt={8} gap={6} testID="download-details-watch">
      {watching ? (
        <Button
          title={t('watchedLinks.watching')}
          variant="ghost"
          size="small"
          leftIcon="eye-check-outline"
          onPress={() => navigation.push(WATCHED_LINKS_ROUTE)}
          testID="download-details-watch-open"
        />
      ) : (
        <Button
          title={t('watchedLinks.watchThis')}
          variant="outline"
          size="small"
          leftIcon="eye-refresh-outline"
          loading={busy}
          onPress={() => void watch()}
          accessibilityHint={t('watchedLinks.watchThisHint')}
          testID="download-details-watch-add"
        />
      )}
      {message ? (
        <Text variant="caption" color="textSecondary">
          {message}
        </Text>
      ) : null}
    </Box>
  );
});
