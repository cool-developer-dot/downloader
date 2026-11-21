import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { DsHeader, DsScreen } from '@/design';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { Switch } from '@/components/inputs/Switch';
import { TextField } from '@/components/inputs/TextField';
import { addLinkFromBatch } from '@/browser/media-actions/batch-add.service';
import type { BatchOutcome } from '@/browser/services/link-intake';
import {
  DEFAULT_WATCH_INTERVAL_HOURS,
  MAX_WATCHED_LINKS,
  normalizeWatchUrl,
  WATCH_INTERVAL_HOURS,
  type WatchedLink,
  type WatchFeedItem,
} from '@/downloads/watch/watch-core';
import { getWatchPort } from '@/downloads/watch/watch-port';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { formatDownloadDate } from '@/screens/downloads/utils/download-format';
import { useSettingsTokens } from '@/screens/settings/theme/settings-tokens';
import { useSettingsStore } from '@/store/settings';

type IntervalValue = '1' | '6' | '24' | '168';

function dateOf(ms: number | null): string | null {
  return ms ? formatDownloadDate(new Date(ms).toISOString()) : null;
}

const OUTCOME_KEY: Record<BatchOutcome, 'watchedLinks.queued' | 'watchedLinks.duplicate' | 'watchedLinks.needsReview' | 'watchedLinks.refused'> = {
  added: 'watchedLinks.queued',
  duplicate: 'watchedLinks.duplicate',
  'needs-review': 'watchedLinks.needsReview',
  refused: 'watchedLinks.refused',
};

/**
 * #362 Link Polling, #504 Update Detection, #363 RSS Download: the links VidoraX checks by itself (a native job
 * about every hour, only the links that are due), with a feed's latest videos ready to download. Everything stays
 * on the phone.
 */
export const WatchedLinksScreen = memo(function WatchedLinksScreen() {
  const { t } = useTranslation();
  const tokens = useSettingsTokens();
  // Once per screen: a new port object each render would re-run the focus effect and reload in a loop.
  const port = useMemo(() => getWatchPort(), []);
  const [links, setLinks] = useState<WatchedLink[]>([]);
  const [url, setUrl] = useState('');
  const [interval, setIntervalValue] = useState<IntervalValue>(String(DEFAULT_WATCH_INTERVAL_HOURS) as IntervalValue);
  const [autoDownload, setAutoDownload] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [itemState, setItemState] = useState<Record<string, string>>({});
  const abort = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!port) return;
    setLinks(await port.list().catch(() => []));
  }, [port]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  useEffect(() => () => abort.current?.abort(), []);

  const intervalOptions = [
    { value: '1' as const, label: t('watchedLinks.hourly') },
    { value: '6' as const, label: t('watchedLinks.sixHours') },
    { value: '24' as const, label: t('watchedLinks.daily') },
    { value: '168' as const, label: t('watchedLinks.weekly') },
  ];

  const add = useCallback(async () => {
    if (!port) return;
    const target = normalizeWatchUrl(url);
    if (!target) {
      setMessage(t('watchedLinks.invalidUrl'));
      return;
    }
    setAdding(true);
    setMessage(null);
    const result = await port.add(target, { intervalHours: Number(interval), autoDownload }).catch(() => null);
    setAdding(false);
    if (result?.ok) {
      setUrl('');
      setMessage(t('watchedLinks.added'));
      await reload();
    } else if (result?.reason === 'full') {
      setMessage(t('watchedLinks.full', { count: MAX_WATCHED_LINKS }));
    } else {
      setMessage(t('watchedLinks.unreachable'));
    }
  }, [autoDownload, interval, port, reload, t, url]);

  const checkNow = useCallback(
    async (id: string) => {
      if (!port) return;
      setChecking(id);
      await port.check(id).catch(() => null);
      setChecking(null);
      await reload();
    },
    [port, reload],
  );

  const update = useCallback(
    async (id: string, change: { intervalHours?: number; autoDownload?: boolean }) => {
      if (!port) return;
      await port.update(id, change).catch(() => null);
      await reload();
    },
    [port, reload],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!port) return;
      await port.remove(id).catch(() => false);
      await reload();
    },
    [port, reload],
  );

  const download = useCallback(
    async (item: WatchFeedItem) => {
      setItemState((s) => ({ ...s, [item.id]: t('watchedLinks.checking') }));
      abort.current ??= new AbortController();
      const rules = useSettingsStore.getState().linkRules;
      const result = await addLinkFromBatch(item.mediaUrl, abort.current.signal, { rules, title: item.title }).catch(() => null);
      setItemState((s) => ({ ...s, [item.id]: t(result ? OUTCOME_KEY[result.outcome] : 'watchedLinks.refused') }));
    },
    [t],
  );

  const kindLabel = (link: WatchedLink) =>
    link.kind === 'feed' ? t('watchedLinks.kindFeed') : link.kind === 'file' ? t('watchedLinks.kindFile') : t('watchedLinks.kindPage');

  return (
    <DsScreen testID="watched-links-screen" edges={['top', 'bottom']}>
      <DsHeader title={t('watchedLinks.title')} onBack={() => navigation.back()} testID="watched-links-header" />
      {!port ? (
        <EmptyState icon="update" title={t('watchedLinks.title')} description={t('watchedLinks.unavailable')} />
      ) : (
        <>
          <Text variant="bodySmall" color="textSecondary">
            {t('watchedLinks.hint')}
          </Text>
          <TextField
            label={t('watchedLinks.urlLabel')}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            helperText={t('watchedLinks.urlHelper')}
            testID="watched-links-url"
          />
          <Box gap={6}>
            <Text variant="label" color="textSecondary">
              {t('watchedLinks.every')}
            </Text>
            <SegmentedControl
              options={intervalOptions}
              value={interval}
              onChange={setIntervalValue}
              accessibilityLabel={t('watchedLinks.every')}
              testID="watched-links-interval"
            />
          </Box>
          <Box row rtlRow gap={12} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box flex={1} gap={2}>
              <Text variant="body">{t('watchedLinks.autoDownload')}</Text>
              <Text variant="caption" color="textSecondary">
                {t('watchedLinks.autoDownloadHint')} {t('watchedLinks.autoDownloadPageNote')}
              </Text>
            </Box>
            <Switch
              value={autoDownload}
              onValueChange={setAutoDownload}
              accessibilityLabel={t('watchedLinks.autoDownload')}
              testID="watched-links-auto-download"
            />
          </Box>
          <Button
            title={adding ? t('watchedLinks.adding') : t('watchedLinks.add')}
            leftIcon="eye-plus-outline"
            loading={adding}
            disabled={url.trim() === ''}
            onPress={() => void add()}
            testID="watched-links-add"
          />
          {message ? (
            <Text variant="bodySmall" color="textSecondary" accessibilityLiveRegion="polite" testID="watched-links-message">
              {message}
            </Text>
          ) : null}

          {links.length === 0 ? (
            <EmptyState icon="eye-outline" title={t('watchedLinks.emptyTitle')} description={t('watchedLinks.emptyDescription')} testID="watched-links-empty" />
          ) : (
            links.map((link) => (
              <Box
                key={link.id}
                gap={8}
                p={12}
                borderRadius={12}
                style={{ backgroundColor: tokens.card, borderColor: tokens.cardBorder, borderWidth: 1 }}
                testID={`watched-link-${link.id}`}>
                <Text variant="caption" color="textSecondary">
                  {kindLabel(link)}
                </Text>
                <Text variant="body" numberOfLines={2}>
                  {link.title ?? link.url}
                </Text>
                {link.title ? (
                  <Text variant="caption" color="textSecondary" numberOfLines={1}>
                    {link.url}
                  </Text>
                ) : null}
                <Text variant="caption" color="textSecondary">
                  {dateOf(link.lastCheckedAt) ? t('watchedLinks.lastChecked', { date: dateOf(link.lastCheckedAt) ?? '' }) : t('watchedLinks.neverChecked')}
                  {dateOf(link.lastChangedAt) ? ` · ${t('watchedLinks.lastChanged', { date: dateOf(link.lastChangedAt) ?? '' })}` : ''}
                </Text>
                {link.lastStatus === 'not_found' || link.lastStatus === 'error' ? (
                  <Text variant="caption" color="error">
                    {link.lastStatus === 'not_found' ? t('watchedLinks.statusNotFound') : t('watchedLinks.statusError')}
                  </Text>
                ) : null}
                <SegmentedControl
                  options={intervalOptions}
                  value={(WATCH_INTERVAL_HOURS.find((h) => h === link.intervalHours) ?? DEFAULT_WATCH_INTERVAL_HOURS).toString() as IntervalValue}
                  onChange={(value) => void update(link.id, { intervalHours: Number(value) })}
                  accessibilityLabel={t('watchedLinks.every')}
                  testID={`watched-link-${link.id}-interval`}
                />
                {link.kind !== 'page' ? (
                  <Box row rtlRow gap={12} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text variant="bodySmall" style={{ flex: 1 }}>
                      {t('watchedLinks.autoDownload')}
                    </Text>
                    <Switch
                      value={link.autoDownload}
                      onValueChange={(value) => void update(link.id, { autoDownload: value })}
                      accessibilityLabel={t('watchedLinks.autoDownload')}
                      testID={`watched-link-${link.id}-auto`}
                    />
                  </Box>
                ) : null}
                {link.kind === 'feed' ? (
                  <Box gap={6}>
                    <Text variant="label" color="textSecondary">
                      {t('watchedLinks.latest')}
                    </Text>
                    {link.items.length === 0 ? (
                      <Text variant="caption" color="textSecondary">
                        {t('watchedLinks.noItems')}
                      </Text>
                    ) : (
                      link.items.map((item) => (
                        <Box key={item.id} row rtlRow gap={8} style={{ alignItems: 'center' }}>
                          <Box flex={1}>
                            <Text variant="bodySmall" numberOfLines={2}>
                              {item.title ?? item.mediaUrl}
                            </Text>
                            {itemState[item.id] ? (
                              <Text variant="caption" color="textSecondary">
                                {itemState[item.id]}
                              </Text>
                            ) : null}
                          </Box>
                          <Button
                            title={t('watchedLinks.download')}
                            size="small"
                            variant="outline"
                            leftIcon="download"
                            disabled={itemState[item.id] !== undefined}
                            onPress={() => void download(item)}
                            testID={`watched-item-${item.id}-download`}
                          />
                        </Box>
                      ))
                    )}
                  </Box>
                ) : null}
                <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }}>
                  <Button
                    title={checking === link.id ? t('watchedLinks.checking') : t('watchedLinks.checkNow')}
                    size="small"
                    variant="outline"
                    leftIcon="refresh"
                    loading={checking === link.id}
                    onPress={() => void checkNow(link.id)}
                    testID={`watched-link-${link.id}-check`}
                  />
                  <Button
                    title={t('watchedLinks.remove')}
                    size="small"
                    variant="ghost"
                    leftIcon="eye-off-outline"
                    onPress={() => void remove(link.id)}
                    testID={`watched-link-${link.id}-remove`}
                  />
                </Box>
              </Box>
            ))
          )}
        </>
      )}
    </DsScreen>
  );
});
