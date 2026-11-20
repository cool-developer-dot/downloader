import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { Switch } from '@/components/inputs/Switch';
import { TextField } from '@/components/inputs/TextField';
import { canSaveFetchedPages } from '@/browser/capture/offline-pages.service';
import { addLinkFromBatch } from '@/browser/media-actions/batch-add.service';
import type { BatchOutcome } from '@/browser/services/link-intake';
import { MAX_SITE_PAGES, type SiteVideo } from '@/browser/site-grabber/site-grab-core';
import { grabSite, type SiteGrabProgress, type SiteGrabResult } from '@/browser/site-grabber/site-grabber.service';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { PrivateCheckbox } from '@/screens/private/PrivateCheckbox';
import { useSettingsTokens } from '@/screens/settings/theme/settings-tokens';
import { useSettingsStore } from '@/store/settings';

/** Up to this many found videos start chosen. */
const AUTO_SELECT_MAX = 20;

const OUTCOME_KEY: Record<BatchOutcome, 'watchedLinks.queued' | 'watchedLinks.duplicate' | 'watchedLinks.needsReview' | 'watchedLinks.refused'> = {
  added: 'watchedLinks.queued',
  duplicate: 'watchedLinks.duplicate',
  'needs-review': 'watchedLinks.needsReview',
  refused: 'watchedLinks.refused',
};

/**
 * #486 Site grabber: reads one site's pages (robots.txt respected, one a second, two links deep, at most 50), keeps
 * each in Saved pages, and lists the videos they name for the user to pick — added through the same checks as Batch
 * Add, download rules included.
 */
export const SiteGrabberScreen = memo(function SiteGrabberScreen() {
  const { t } = useTranslation();
  const tokens = useSettingsTokens();
  const params = useLocalSearchParams<{ url?: string }>();
  const canSave = canSaveFetchedPages();
  const [url, setUrl] = useState(typeof params.url === 'string' ? params.url : '');
  const [saveOffline, setSaveOffline] = useState(canSave);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SiteGrabProgress | null>(null);
  const [result, setResult] = useState<SiteGrabResult['outcome'] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, BatchOutcome>>({});
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setResult(null);
    setOutcomes({});
    setSelected(new Set());
    const finished = await grabSite(url.trim(), { saveOffline, signal: controller.signal, onProgress: setProgress });
    setProgress(finished);
    // A short list starts all chosen; a long one starts empty, so nothing large is queued by one tap.
    setSelected(new Set(finished.videos.length <= AUTO_SELECT_MAX ? finished.videos.map((v) => v.url) : []));
    setResult(finished.outcome);
    setRunning(false);
  }, [saveOffline, url]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const videos: SiteVideo[] = progress?.videos ?? [];
  const chosen = videos.filter((v) => selected.has(v.url) && outcomes[v.url] === undefined);

  const downloadChosen = useCallback(async () => {
    const list = chosen;
    const controller = new AbortController();
    abort.current = controller;
    const rules = useSettingsStore.getState().linkRules;
    setAdding({ done: 0, total: list.length });
    for (const [index, video] of list.entries()) {
      if (controller.signal.aborted) break;
      const added = await addLinkFromBatch(video.url, controller.signal, { rules }).catch(() => null);
      setOutcomes((o) => ({ ...o, [video.url]: added?.outcome ?? 'refused' }));
      setAdding({ done: index + 1, total: list.length });
    }
    setAdding(null);
  }, [chosen]);

  const toggle = useCallback((videoUrl: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(videoUrl)) next.delete(videoUrl);
      else next.add(videoUrl);
      return next;
    });
  }, []);

  const message =
    result === 'invalid'
      ? t('siteGrabber.invalid')
      : result === 'incognito'
        ? t('siteGrabber.incognito')
        : result === 'unavailable'
          ? t('siteGrabber.unavailable')
          : result === 'stopped'
            ? t('siteGrabber.stopped')
            : result === 'done'
              ? t('siteGrabber.done')
              : null;

  return (
    <SafeAreaScreen
      testID="site-grabber-screen"
      scrollable
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: tokens.background }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: tokens.spacing.screenX, paddingBottom: 40, gap: 16 }}>
      <ScreenHeader title={t('siteGrabber.title')} showBack onBackPress={() => navigation.back()} testID="site-grabber-header" />
      <Text variant="bodySmall" color="textSecondary">
        {t('siteGrabber.hint', { pages: MAX_SITE_PAGES })}
      </Text>
      <TextField
        label={t('siteGrabber.urlLabel')}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        disabled={running}
        testID="site-grabber-url"
      />
      {canSave ? (
        <Box row rtlRow gap={12} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Box flex={1} gap={2}>
            <Text variant="body">{t('siteGrabber.saveOffline')}</Text>
            <Text variant="caption" color="textSecondary">
              {t('siteGrabber.saveOfflineHint')}
            </Text>
          </Box>
          <Switch
            value={saveOffline}
            onValueChange={setSaveOffline}
            disabled={running}
            accessibilityLabel={t('siteGrabber.saveOffline')}
            testID="site-grabber-save-offline"
          />
        </Box>
      ) : null}
      {running ? (
        <Button title={t('siteGrabber.stop')} variant="outline" leftIcon="stop" onPress={stop} testID="site-grabber-stop" />
      ) : (
        <Button title={t('siteGrabber.start')} leftIcon="web-sync" disabled={url.trim() === '' || adding !== null} onPress={() => void start()} testID="site-grabber-start" />
      )}

      {progress ? (
        <Box gap={4} testID="site-grabber-progress">
          {progress.current ? (
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {t('siteGrabber.reading', { url: progress.current })}
            </Text>
          ) : null}
          <Text variant="bodySmall" accessibilityLiveRegion="polite">
            {t('siteGrabber.progress', { read: progress.read, saved: progress.saved, videos: progress.videos.length })}
          </Text>
          {progress.blocked > 0 || progress.failed > 0 ? (
            <Text variant="caption" color="textSecondary">
              {t('siteGrabber.skipped', { blocked: progress.blocked, failed: progress.failed })}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {message ? (
        <Text variant="bodySmall" color={result === 'done' || result === 'stopped' ? 'textSecondary' : 'error'} testID="site-grabber-message">
          {message}
        </Text>
      ) : null}
      {result === 'done' && (progress?.saved ?? 0) > 0 ? (
        <Button title={t('siteGrabber.openSaved')} variant="ghost" size="small" leftIcon="archive-outline" onPress={() => navigation.push(routePaths.savedPages)} testID="site-grabber-open-saved" />
      ) : null}

      {progress && !running ? (
        <Box gap={8}>
          <Text variant="label" color="textSecondary">
            {t('siteGrabber.videos')}
          </Text>
          {videos.length === 0 ? (
            <Text variant="caption" color="textSecondary">
              {t('siteGrabber.noVideos')}
            </Text>
          ) : (
            <>
              <Box row rtlRow gap={8} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>
                  {t('bulkAdd.chosenCount', { selected: chosen.length, total: videos.length })}
                </Text>
                <Button
                  title={t('bulkAdd.selectAll')}
                  variant="ghost"
                  size="small"
                  onPress={() => setSelected(new Set(videos.map((v) => v.url)))}
                  testID="site-grabber-select-all"
                />
                <Button title={t('bulkAdd.selectNone')} variant="ghost" size="small" onPress={() => setSelected(new Set())} testID="site-grabber-select-none" />
              </Box>
              {videos.map((video) => (
                <Box key={video.url} gap={2}>
                  <PrivateCheckbox
                    checked={selected.has(video.url) && outcomes[video.url] === undefined}
                    onToggle={() => outcomes[video.url] === undefined && toggle(video.url)}
                    label={`${video.title ?? video.pageUrl} — ${video.url.split('/').pop()?.split('?')[0] ?? video.url}`}
                    testID={`site-grabber-video-${video.url}`}
                  />
                  {outcomes[video.url] ? (
                    <Text variant="caption" color="textSecondary">
                      {t(OUTCOME_KEY[outcomes[video.url]!])}
                    </Text>
                  ) : null}
                </Box>
              ))}
              <Button
                title={adding ? t('siteGrabber.downloading', adding) : t('siteGrabber.download', { count: chosen.length })}
                leftIcon="download-multiple"
                loading={adding !== null}
                disabled={chosen.length === 0}
                onPress={() => void downloadChosen()}
                testID="site-grabber-download"
              />
            </>
          )}
        </Box>
      ) : null}
    </SafeAreaScreen>
  );
});
