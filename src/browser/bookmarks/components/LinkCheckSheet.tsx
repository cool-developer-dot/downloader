import { memo, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { Divider } from '@/components/common/Divider';
import { Switch } from '@/components/inputs/Switch';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTranslation, type TranslationKey } from '@/localization';
import { bookmarkOrganizerRepository } from '@/storage/repositories';
import { useSettingsStore } from '@/store/settings';

import { change, linkCheckAllowedNow, notify, runLinkCheck } from '../bookmarks.service';
import type { LinkCheckResult, LinkCheckStatus } from '../link-check';

const STATUS_LABELS: Record<LinkCheckStatus, TranslationKey> = {
  works: 'browserBookmarks.checkWorks',
  moved: 'browserBookmarks.checkMoved',
  notFound: 'browserBookmarks.checkNotFound',
  unreachable: 'browserBookmarks.checkUnreachable',
};

/**
 * B9 #91 — Check links: Wi-Fi only by default, progress and Cancel, then each problem with its result; Moved offers
 * the new address. Nothing is deleted or changed unless the user taps "Use new address".
 */
export const LinkCheckSheet = memo(function LinkCheckSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, rtl } = useTranslation();
  const wifiOnly = useSettingsStore((s) => s.linkCheckWifiOnly !== false);
  const update = useSettingsStore((s) => s.updateSetting);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<LinkCheckResult[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!visible) {
      abort.current?.abort();
      setRunning(false);
    }
  }, [visible]);

  const start = async () => {
    if (!(await linkCheckAllowedNow())) {
      notify(t('browserBookmarks.checkNeedsWifi'));
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: 0 });
    const links = await bookmarkOrganizerRepository.listAllLinks();
    setTitles(Object.fromEntries(links.map((l) => [l.id, l.title])));
    setProgress({ done: 0, total: links.length });
    await runLinkCheck(controller.signal, (result, done, total) => {
      setProgress({ done, total });
      setResults((list) => [...list, result]);
    });
    setRunning(false);
  };

  const counts = results.reduce(
    (acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }),
    { works: 0, moved: 0, notFound: 0, unreachable: 0 } as Record<LinkCheckStatus, number>,
  );
  const problems = results.filter((r) => r.status !== 'works');

  return (
    <SheetFrame
      visible={visible}
      title={t('browserBookmarks.checkTitle')}
      onClose={onClose}
      testID="bookmark-link-check"
      footer={
        running ? (
          <Button title={t('browserBookmarks.checkCancel')} variant="outline" onPress={() => abort.current?.abort()} testID="link-check-cancel" />
        ) : (
          <Button title={t('browserBookmarks.checkStart')} onPress={() => void start()} testID="link-check-start" />
        )
      }>
      <Text variant="caption" color="textSecondary">
        {t('browserBookmarks.checkIntro')}
      </Text>
      <View style={{ minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
        <Text variant="body" style={{ flex: 1 }}>
          {t('browserBookmarks.checkWifiOnly')}
        </Text>
        <Switch
          value={wifiOnly}
          onValueChange={(next) => update('linkCheckWifiOnly', next)}
          disabled={running}
          accessibilityLabel={t('browserBookmarks.checkWifiOnly')}
          testID="link-check-wifi-only"
        />
      </View>
      {progress ? (
        <Text variant="label" accessibilityLiveRegion="polite" style={{ marginVertical: 4 }}>
          {t('browserBookmarks.checkProgress', progress)}
        </Text>
      ) : null}
      {results.length > 0 ? (
        <Text variant="caption" color="textSecondary">
          {t('browserBookmarks.checkSummary', counts)}
        </Text>
      ) : null}
      {problems.map((result, index) => (
        <View key={result.id} style={{ paddingVertical: 8 }}>
          {index > 0 ? <Divider /> : null}
          <Text variant="body" numberOfLines={2}>
            {titles[result.id] ?? result.url}
          </Text>
          <Text variant="caption" color={result.status === 'moved' ? 'textSecondary' : 'error'} numberOfLines={2}>
            {t(STATUS_LABELS[result.status])} · {result.url}
          </Text>
          {result.status === 'moved' && result.newUrl ? (
            <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
              <Text variant="caption" color="primary" numberOfLines={2} style={{ flex: 1 }}>
                {result.newUrl}
              </Text>
              <Button
                title={t('browserBookmarks.useNewAddress')}
                variant="ghost"
                accessibilityLabel={t('browserBookmarks.useNewAddressA11y', { title: titles[result.id] ?? '', url: result.newUrl })}
                onPress={() =>
                  void change(() => bookmarkOrganizerRepository.setUrl(result.id, result.newUrl!), t('browserBookmarks.addressUpdated')).then(
                    (ok) => {
                      if (ok !== null) setResults((list) => list.map((r) => (r.id === result.id ? { ...r, status: 'works', newUrl: null } : r)));
                    },
                  )
                }
                testID={`link-check-use-${result.id}`}
              />
            </View>
          ) : null}
        </View>
      ))}
    </SheetFrame>
  );
});
