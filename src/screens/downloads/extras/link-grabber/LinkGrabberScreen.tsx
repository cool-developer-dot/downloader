import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { grabPageLinks } from '@/browser/services/page-link-grabber';
import { selectCurrentUrl, useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { isValidBrowserPageUrl } from '@/browser/utils/url';
import { Pressable } from '@/components/base/Pressable';
import { ds, DsButton, DsCard, DsChip, DsChipRow, DsHeader, DsIcon, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { navigation, routePaths } from '@/navigation';
import { batchAddPrefill } from '@/screens/batch-add/batch-add-prefill';
import { siteGrabberPath } from '@/screens/site-grabber/route';
import { WATCHED_LINKS_ROUTE } from '@/screens/watched-links/route';

import { toast } from '../shared/toast';
import { useSettingsHeaderAction } from '../shared/use-settings-header-action';

import {
  applyRules,
  LINK_FILTERS,
  linkFileName,
  linkHost,
  matchesFilter,
  mergeLinks,
  pageHostPath,
  type LinkFilter,
  type LinkRules,
} from './link-grabber-model';
import { PatternModal } from './PatternModal';
import { RulesModal } from './RulesModal';

type ScanStatus = 'scanning' | 'done' | 'failed' | 'no-page';

const FILTER_LABELS: Record<LinkFilter, TranslationKey> = {
  all: 'downloads.filterAll',
  video: 'lightLinkGrabber.video',
  audio: 'filesTab.audio',
  docs: 'filesTab.docs',
  images: 'filesTab.images',
};

/** The design's selected / unselected tile in a link row's icon place. */
const CheckTile = memo(function CheckTile({ checked }: { checked: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: ds.size.iconTile,
        height: ds.size.iconTile,
        borderRadius: ds.radius.iconTile,
        backgroundColor: theme.colors.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <DsIcon name={checked ? 'check' : 'square'} size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
    </View>
  );
});

/**
 * Design 43 "Link grabber": the video links of the page in the browser's active tab (Page Link Grabber #484), filtered
 * by chips and include / exclude rules, extended by a pattern download, and handed to Batch Add (#292) as a prefill.
 */
export const LinkGrabberScreen = memo(function LinkGrabberScreen() {
  const { t } = useTranslation();
  const settingsAction = useSettingsHeaderAction();
  const currentUrl = useBrowserStore(selectCurrentUrl);
  const [status, setStatus] = useState<ScanStatus>('scanning');
  const [links, setLinks] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [filter, setFilter] = useState<LinkFilter>('all');
  const [pattern, setPattern] = useState('');
  const [rules, setRules] = useState<LinkRules>({ include: '', exclude: '' });
  const [patternOpen, setPatternOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const alive = useRef(true);

  const scan = useCallback(async () => {
    const { currentUrl: url, activeTabId } = useBrowserStore.getState();
    if (!isValidBrowserPageUrl(url)) {
      setStatus('no-page');
      return;
    }
    setStatus('scanning');
    const webView = tabControllerRegistry.getActive(activeTabId)?.webViewRef.current;
    const found = await grabPageLinks(webView);
    if (!alive.current) {
      return;
    }
    if (found == null) {
      setStatus('failed');
      return;
    }
    setLinks(found);
    setSelected(Object.fromEntries(found.map((link) => [link, true])));
    setStatus('done');
  }, []);

  useEffect(() => {
    alive.current = true;
    void scan();
    return () => {
      alive.current = false;
    };
  }, [scan]);

  const visible = useMemo(() => applyRules(links, rules).filter((url) => matchesFilter(url, filter)), [filter, links, rules]);
  const selectedLinks = useMemo(() => links.filter((url) => selected[url]), [links, selected]);

  const toggle = useCallback((url: string) => {
    setSelected((current) => {
      const next = { ...current };
      if (next[url]) {
        delete next[url];
      } else {
        next[url] = true;
      }
      return next;
    });
  }, []);

  const addPattern = useCallback(
    (used: string, added: string[]) => {
      setPattern(used);
      setLinks((current) => mergeLinks(current, added));
      setSelected((current) => ({ ...current, ...Object.fromEntries(added.map((link) => [link, true] as const)) }));
      toast(added.length === 1 ? t('lightLinkGrabber.patternAddedOne') : t('lightLinkGrabber.patternAddedOther', { count: added.length }));
    },
    [t],
  );

  const addSelected = useCallback(() => {
    if (selectedLinks.length === 0) {
      return;
    }
    batchAddPrefill.set(selectedLinks.join('\n'));
    navigation.push(routePaths.batchAdd);
  }, [selectedLinks]);

  const countLine =
    status === 'scanning'
      ? t('lightLinkGrabber.scanning')
      : status === 'no-page'
        ? t('lightLinkGrabber.noPage')
        : status === 'failed'
          ? t('lightLinkGrabber.pageFailed')
          : links.length === 1
            ? t('lightLinkGrabber.linksFoundOne')
            : t('lightLinkGrabber.linksFoundOther', { count: links.length });
  // P4 #363 feeds live with the watched links (P3); P5 #486 saves the site the page belongs to.
  const openFeeds = useCallback(() => navigation.push(WATCHED_LINKS_ROUTE), []);
  const openSiteGrabber = useCallback(() => navigation.push(siteGrabberPath(status === 'no-page' ? null : currentUrl)), [currentUrl, status]);
  const pageTitle = status === 'no-page' ? '—' : pageHostPath(currentUrl) || '—';

  return (
    <DsScreen
      testID="link-grabber-screen"
      footer={
        <DsButton
          label={t('lightLinkGrabber.addSelected')}
          fullWidth
          onPress={addSelected}
          disabled={selectedLinks.length === 0}
          testID="link-grabber-add-selected"
        />
      }>
      <DsHeader title={t('lightLinkGrabber.title')} subtitle={t('lightLinkGrabber.subtitle')} action={settingsAction} />

      <Pressable
        onPress={() => void scan()}
        disabled={status === 'scanning'}
        accessibilityRole="button"
        accessibilityLabel={`${pageTitle}, ${countLine}`}
        accessibilityHint={t('lightLinkGrabber.rescanA11y')}
        testID="link-grabber-page">
        <DsCard>
          <DsText variant="cardTitle" numberOfLines={1}>
            {pageTitle}
          </DsText>
          <DsText variant="body" style={{ marginTop: 4 }} testID="link-grabber-count">
            {countLine}
          </DsText>
        </DsCard>
      </Pressable>

      <DsChipRow>
        {LINK_FILTERS.map((value) => (
          <DsChip key={value} label={t(FILTER_LABELS[value])} selected={filter === value} onPress={() => setFilter(value)} testID={`link-grabber-filter-${value}`} />
        ))}
      </DsChipRow>

      {visible.length > 0 ? (
        <DsRowGroup testID="link-grabber-links">
          {visible.map((url) => {
            const name = linkFileName(url);
            const checked = Boolean(selected[url]);
            return (
              <DsRow
                key={url}
                leading={<CheckTile checked={checked} />}
                title={name}
                subtitle={linkHost(url)}
                onPress={() => toggle(url)}
                accessibilityLabel={checked ? t('lightLinkGrabber.deselectA11y', { name }) : t('lightLinkGrabber.selectA11y', { name })}
              />
            );
          })}
        </DsRowGroup>
      ) : null}

      <DsRowGroup testID="link-grabber-tools">
        <DsRow
          icon="layers"
          title={t('lightLinkGrabber.patternDownload')}
          subtitle={pattern || undefined}
          onPress={() => setPatternOpen(true)}
          testID="link-grabber-pattern"
        />
        <DsRow icon="cast" title={t('lightLinkGrabber.rssDownload')} subtitle={t('watchedLinks.rowHint')} onPress={openFeeds} testID="link-grabber-rss" />
        <DsRow icon="box" title={t('lightLinkGrabber.includeExcludeRules')} onPress={() => setRulesOpen(true)} testID="link-grabber-rules" />
        <DsRow icon="globe" title={t('lightLinkGrabber.siteGrabber')} subtitle={t('siteGrabber.rowHint')} onPress={openSiteGrabber} testID="link-grabber-site" />
      </DsRowGroup>

      <PatternModal visible={patternOpen} initial={pattern} onAdd={addPattern} onClose={() => setPatternOpen(false)} />
      <RulesModal visible={rulesOpen} rules={rules} onApply={setRules} onClose={() => setRulesOpen(false)} />
    </DsScreen>
  );
});
