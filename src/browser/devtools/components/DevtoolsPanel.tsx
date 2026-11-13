import { memo, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable as RNPressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PageCertificate } from '@modules/vidorax-web';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { Switch } from '@/components/inputs/Switch';
import { TextField } from '@/components/inputs/TextField';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { getPageCertificate } from '@/browser/privacy/privacy.service';
import { reloadForTab } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';

import {
  DEVICE_PRESETS,
  DEVTOOLS_UA_MODES,
  type ConsoleEntry,
  type DevtoolsUaMode,
  type StorageItem,
} from '../devtools-core';
import {
  evalCommand,
  inspectCommand,
  NETWORK_COMMAND,
  SOURCE_COMMAND,
  STORAGE_READ_COMMAND,
  storageDeleteCommand,
} from '../devtools-commands';
import {
  awaitInspectTap,
  clearConsole,
  closeDevtoolsPanel,
  getPanelSection,
  setPanelSection,
  deleteTabCookie,
  getTabData,
  getTabDevtools,
  readTabCookies,
  runInPage,
  setTabDevtools,
  useDevtoolsPanelTab,
  useDevtoolsVersion,
  useUserScripts,
} from '../devtools.service';

type Section = 'console' | 'network' | 'inspect' | 'source' | 'storage' | 'security' | 'scripts' | 'device';
const SECTIONS: { id: Section; label: TranslationKey }[] = [
  { id: 'console', label: 'browserDevtools.tabConsole' },
  { id: 'network', label: 'browserDevtools.tabNetwork' },
  { id: 'inspect', label: 'browserDevtools.tabInspect' },
  { id: 'source', label: 'browserDevtools.tabSource' },
  { id: 'storage', label: 'browserDevtools.tabStorage' },
  { id: 'security', label: 'browserDevtools.tabSecurity' },
  { id: 'scripts', label: 'browserDevtools.tabScripts' },
  { id: 'device', label: 'browserDevtools.tabDevice' },
];

/** B19 — Menu → Developer tools: a bottom panel over the page of the tab it was opened on. */
export const DevtoolsPanel = memo(function DevtoolsPanel() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, rtl } = useTranslation();
  const tabId = useDevtoolsPanelTab();
  const [section, setSectionState] = useState<Section>(() => getPanelSection() as Section);
  const setSection = (next: Section) => {
    setPanelSection(next);
    setSectionState(next);
  };
  useEffect(() => {
    if (tabId) setSectionState(getPanelSection() as Section);
  }, [tabId]);
  if (!tabId) return null;
  // Closing by hand also takes the inspect outline off the page.
  const close = () => {
    runInPage(tabId, inspectCommand('stop'));
    closeDevtoolsPanel();
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable accessibilityRole="button" accessibilityLabel={t('browserDevtools.close')} onPress={close} style={{ flex: 1 }} />
        <View
          testID="browser-devtools"
          style={{
            height: '62%',
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingBottom: insets.bottom + 8,
          }}>
          <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', paddingHorizontal: 12, paddingTop: 8 }}>
            <Text variant="title" accessibilityRole="header" style={{ flex: 1, textAlign: rtl.textAlign }}>
              {t('browserDevtools.panelTitle')}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('browserDevtools.close')} onPress={close} style={styles.icon}>
              <Icon name="close" size={22} color="secondary" />
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 8, gap: 4 }} accessibilityRole="tablist">
            {SECTIONS.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: section === s.id }}
                onPress={() => setSection(s.id)}
                testID={`browser-devtools-tab-${s.id}`}
                style={[styles.chip, { borderBottomWidth: 2, borderBottomColor: section === s.id ? theme.colors.primary : 'transparent' }]}>
                <Text variant="label" color={section === s.id ? 'primary' : 'textSecondary'}>
                  {t(s.label)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 8 }}>
            {section === 'console' ? <ConsoleSection tabId={tabId} /> : null}
            {section === 'network' ? <NetworkSection tabId={tabId} /> : null}
            {section === 'inspect' ? <InspectSection tabId={tabId} /> : null}
            {section === 'source' ? <SourceSection tabId={tabId} /> : null}
            {section === 'storage' ? <StorageSection tabId={tabId} /> : null}
            {section === 'security' ? <SecuritySection tabId={tabId} /> : null}
            {section === 'scripts' ? <ScriptsSection tabId={tabId} /> : null}
            {section === 'device' ? <DeviceSection tabId={tabId} /> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
});

const LEVEL_COLOR: Record<ConsoleEntry['level'], 'error' | 'warning' | 'textSecondary' | 'primary' | undefined> = {
  error: 'error',
  warn: 'warning',
  debug: 'textSecondary',
  info: undefined,
  log: undefined,
  result: 'primary',
};

const ConsoleSection = memo(function ConsoleSection({ tabId }: { tabId: string }) {
  'use no memo'; // Reads external state each render (subscribed above): compiled, the React Compiler cached the first read.
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  useDevtoolsVersion();
  const [level, setLevel] = useState<'all' | 'error' | 'warn' | 'log'>('all');
  const [code, setCode] = useState('');
  const entries = getTabData(tabId).console.filter((e) =>
    level === 'all' ? true : level === 'log' ? e.level === 'log' || e.level === 'info' || e.level === 'debug' : e.level === level,
  );
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <View style={{ flexDirection: rtl.rowDirection, gap: 4, flexWrap: 'wrap' }}>
        {(['all', 'error', 'warn', 'log'] as const).map((l) => (
          <Chip key={l} label={l === 'all' ? t('browserDevtools.levelAll') : l} selected={level === l} onPress={() => setLevel(l)} />
        ))}
        <Chip label={t('browserDevtools.clear')} onPress={() => clearConsole(tabId)} />
      </View>
      <FlatList
        data={entries}
        keyExtractor={(_, i) => String(i)}
        style={{ flex: 1 }}
        ListEmptyComponent={<Text variant="caption" color="textSecondary">{t('browserDevtools.consoleEmpty')}</Text>}
        renderItem={({ item }) => (
          <Text variant="caption" color={LEVEL_COLOR[item.level]} selectable style={[styles.mono, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }]}>
            {item.level === 'result' ? '← ' : ''}
            {item.text}
          </Text>
        )}
      />
      <View style={{ flexDirection: rtl.rowDirection, gap: 8, alignItems: 'center' }}>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder={t('browserDevtools.consoleInput')}
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('browserDevtools.consoleInput')}
          style={[styles.mono, styles.input, { flex: 1, color: theme.colors.textPrimary, borderColor: theme.colors.border, textAlign: 'left', writingDirection: 'ltr' }]}
          testID="browser-devtools-console-input"
        />
        <Button
          title={t('browserDevtools.run')}
          onPress={() => {
            if (!code.trim()) return;
            runInPage(tabId, evalCommand(code));
            setCode('');
          }}
          testID="browser-devtools-console-run"
        />
      </View>
    </View>
  );
});

const NetworkSection = memo(function NetworkSection({ tabId }: { tabId: string }) {
  'use no memo'; // Reads external state each render (subscribed above): compiled, the React Compiler cached the first read.
  const { t, rtl } = useTranslation();
  useDevtoolsVersion();
  const network = getTabData(tabId).network;
  useEffect(() => {
    runInPage(tabId, NETWORK_COMMAND);
  }, [tabId]);
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
        {t('browserDevtools.networkNote')}
      </Text>
      <Chip label={t('browserDevtools.refresh')} onPress={() => runInPage(tabId, NETWORK_COMMAND)} />
      <FlatList
        data={network?.entries ?? []}
        keyExtractor={(_, i) => String(i)}
        ListEmptyComponent={<Text variant="caption" color="textSecondary">{t('browserDevtools.networkEmpty')}</Text>}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 4 }}>
            <Text variant="caption" numberOfLines={2} selectable style={styles.mono}>
              {item.url}
            </Text>
            <Text variant="caption" color="textSecondary" style={styles.mono}>
              {[item.type, item.status ?? '—', item.size != null ? `${Math.round(item.size / 102.4) / 10} KB` : '—', `${item.ms} ms`].join('  ·  ')}
            </Text>
          </View>
        )}
      />
    </View>
  );
});

const InspectSection = memo(function InspectSection({ tabId }: { tabId: string }) {
  'use no memo'; // Reads external state each render (subscribed above): compiled, the React Compiler cached the first read.
  const { t, rtl } = useTranslation();
  useDevtoolsVersion();
  const info = getTabData(tabId).inspect;

  return (
    <ScrollView contentContainerStyle={{ gap: 8 }}>
      <View style={{ flexDirection: rtl.rowDirection, gap: 4, flexWrap: 'wrap' }}>
        <Chip
          label={t('browserDevtools.inspectStart')}
          onPress={() => {
            if (runInPage(tabId, inspectCommand('start'))) awaitInspectTap(tabId);
          }}
        />
        <Chip label={t('browserDevtools.inspectParent')} onPress={() => runInPage(tabId, inspectCommand('parent'))} disabled={!info?.hasParent} />
        <Chip label={t('browserDevtools.inspectChild')} onPress={() => runInPage(tabId, inspectCommand('child'))} disabled={!info?.children} />
        <Chip label={t('browserDevtools.inspectNext')} onPress={() => runInPage(tabId, inspectCommand('next'))} disabled={!info} />
        <Chip label={t('browserDevtools.inspectStop')} onPress={() => runInPage(tabId, inspectCommand('stop'))} />
      </View>
      {info ? (
        <View style={{ gap: 4 }}>
          <Text variant="body" selectable style={styles.mono}>
            {`<${info.tag}${info.id ? ` id="${info.id}"` : ''}${info.classes.length ? ` class="${info.classes.join(' ')}"` : ''}>`}
          </Text>
          <Text variant="caption" color="textSecondary">
            {t('browserDevtools.inspectSize', { width: info.width, height: info.height })} ·{' '}
            {t('browserDevtools.inspectChildren', { count: info.children })}
          </Text>
          {Object.entries(info.styles).map(([k, v]) => (
            <Text key={k} variant="caption" selectable style={styles.mono}>
              {k}: {v}
            </Text>
          ))}
          <Chip label={t('browserDevtools.copy')} onPress={() => void Clipboard.setStringAsync(info.html)} />
          <Text variant="caption" selectable style={styles.mono}>
            {info.html}
          </Text>
        </View>
      ) : (
        <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
          {t('browserDevtools.inspectHint')}
        </Text>
      )}
    </ScrollView>
  );
});

const SourceSection = memo(function SourceSection({ tabId }: { tabId: string }) {
  'use no memo'; // Reads external state each render (subscribed above): compiled, the React Compiler cached the first read.
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  useDevtoolsVersion();
  const source = getTabData(tabId).source;
  const [query, setQuery] = useState('');
  const [wrap, setWrap] = useState(false);
  const text = source ? source.parts.join('') : '';
  const lines = useMemo(() => (text ? text.split('\n') : []), [text]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => lines.map((line, i) => ({ n: i + 1, line })).filter((l) => !q || l.line.toLowerCase().includes(q)),
    [lines, q],
  );
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <View style={{ flexDirection: rtl.rowDirection, gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip label={source ? t('browserDevtools.refresh') : t('browserDevtools.sourceLoad')} onPress={() => runInPage(tabId, SOURCE_COMMAND)} />
        <Chip label={t('browserDevtools.copy')} onPress={() => void Clipboard.setStringAsync(text)} disabled={!text} />
        <Text variant="caption">{t('browserDevtools.sourceWrap')}</Text>
        <Switch value={wrap} onValueChange={setWrap} accessibilityLabel={t('browserDevtools.sourceWrap')} />
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('browserDevtools.sourceSearch')}
        placeholderTextColor={theme.colors.textSecondary}
        accessibilityLabel={t('browserDevtools.sourceSearch')}
        autoCapitalize="none"
        style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
      />
      {q ? <Text variant="caption" color="textSecondary">{t('browserDevtools.sourceMatches', { count: shown.length })}</Text> : null}
      {source?.truncated ? <Text variant="caption" color="warning">{t('browserDevtools.sourceTruncated')}</Text> : null}
      <ScrollView horizontal={!wrap} style={{ flex: 1 }} contentContainerStyle={wrap ? undefined : { flexGrow: 1 }}>
        <FlatList
          data={shown}
          keyExtractor={(l) => String(l.n)}
          initialNumToRender={60}
          renderItem={({ item }) => (
            <Text variant="caption" selectable style={styles.mono}>
              <Text variant="caption" color="textSecondary" style={styles.mono}>
                {String(item.n).padStart(5, ' ')}{'  '}
              </Text>
              {item.line}
            </Text>
          )}
        />
      </ScrollView>
    </View>
  );
});

const StorageSection = memo(function StorageSection({ tabId }: { tabId: string }) {
  'use no memo'; // Reads external state each render (subscribed above): compiled, the React Compiler cached the first read.
  const { t, rtl } = useTranslation();
  useDevtoolsVersion();
  const url = useBrowserStore((s) => s.tabs.find((tab) => tab.id === tabId)?.url ?? '');
  const items = getTabData(tabId).storage;
  const [cookies, setCookies] = useState<{ name: string; value: string }[]>([]);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const refresh = () => {
    runInPage(tabId, STORAGE_READ_COMMAND);
    void readTabCookies(tabId, url).then(setCookies);
  };
  useEffect(refresh, [tabId, url]);
  const toggle = (key: string) =>
    setShown((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const row = (key: string, label: string, value: string, onDelete: () => void) => (
    <View key={key} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', minHeight: 48, gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityHint={t('browserDevtools.storageShow')} onPress={() => toggle(key)} style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
        <Text variant="caption" style={styles.mono} numberOfLines={1}>
          {label}
        </Text>
        <Text variant="caption" color="textSecondary" selectable style={styles.mono} numberOfLines={shown.has(key) ? 20 : 1}>
          {shown.has(key) ? value : '••••••'}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('browserDevtools.storageDeleteA11y', { name: label })} onPress={onDelete} style={styles.icon}>
        <Icon name="delete-outline" size={20} color="error" />
      </Pressable>
    </View>
  );
  const byArea = (area: StorageItem['area']) => (items ?? []).filter((i) => i.area === area);
  return (
    <ScrollView contentContainerStyle={{ gap: 6 }}>
      <View style={{ flexDirection: rtl.rowDirection, gap: 4, flexWrap: 'wrap' }}>
        <Chip label={t('browserDevtools.refresh')} onPress={refresh} />
        <Chip label={t('browserDevtools.storageClearSite')} onPress={() => setConfirmClear(true)} disabled={!host} />
      </View>
      <Text variant="label" accessibilityRole="header">{t('browserDevtools.storageCookies')}</Text>
      {cookies.length === 0 ? <Text variant="caption" color="textSecondary">{t('browserDevtools.storageEmpty')}</Text> : null}
      {cookies.map((c) =>
        row(`c:${c.name}`, c.name || '(no name)', c.value, () => void deleteTabCookie(tabId, url, c.name).then(refresh)),
      )}
      <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>{t('browserDevtools.storageCookieNote')}</Text>
      {(['local', 'session'] as const).map((area) => (
        <View key={area} style={{ gap: 4 }}>
          <Text variant="label" accessibilityRole="header">
            {t(area === 'local' ? 'browserDevtools.storageLocal' : 'browserDevtools.storageSession')}
          </Text>
          {byArea(area).length === 0 ? <Text variant="caption" color="textSecondary">{t('browserDevtools.storageEmpty')}</Text> : null}
          {byArea(area).map((i) => row(`${area}:${i.key}`, i.key, i.value, () => void runInPage(tabId, storageDeleteCommand(area, i.key))))}
        </View>
      ))}
      <ConfirmModal
        visible={confirmClear}
        variant="delete"
        title={t('browserDevtools.storageClearTitle')}
        message={t('browserDevtools.storageClearMessage', { site: host })}
        confirmLabel={t('browserDevtools.storageClearSite')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setConfirmClear(false);
          runInPage(tabId, storageDeleteCommand(null, null));
          void deleteTabCookie(tabId, url, null).then(refresh);
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </ScrollView>
  );
});

const SecuritySection = memo(function SecuritySection({ tabId }: { tabId: string }) {
  'use no memo'; // Reads external state each render (subscribed above): compiled, the React Compiler cached the first read.
  const { t, rtl } = useTranslation();
  useDevtoolsVersion();
  const url = useBrowserStore((s) => s.tabs.find((tab) => tab.id === tabId)?.url ?? '');
  const [certificate, setCertificate] = useState<PageCertificate | null | undefined>(undefined);
  const network = getTabData(tabId).network;
  useEffect(() => {
    void getPageCertificate(tabId).then(setCertificate);
    runInPage(tabId, NETWORK_COMMAND);
  }, [tabId, url]);
  const protocol = (() => {
    try {
      return new URL(url).protocol.replace(':', '');
    } catch {
      return '—';
    }
  })();
  const date = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');
  const line = (label: string, value: string) => (
    <View style={{ flexDirection: rtl.rowDirection, gap: 8 }}>
      <Text variant="caption" color="textSecondary" style={{ width: 100, textAlign: rtl.textAlign }}>{label}</Text>
      <Text variant="caption" selectable style={{ flex: 1, textAlign: rtl.textAlign }}>{value}</Text>
    </View>
  );
  return (
    <ScrollView contentContainerStyle={{ gap: 8 }}>
      {line(t('browserDevtools.securityProtocol'), protocol)}
      <Text variant="label" accessibilityRole="header">{t('browserDevtools.securityCertificate')}</Text>
      {certificate ? (
        <>
          {line(t('browserDevtools.securityIssuedTo'), [certificate.issuedToName, certificate.issuedToOrganization].filter(Boolean).join(' · ') || '—')}
          {line(t('browserDevtools.securityIssuedBy'), [certificate.issuedByName, certificate.issuedByOrganization].filter(Boolean).join(' · ') || '—')}
          {line(t('browserDevtools.securityValid'), `${date(certificate.validFrom)} → ${date(certificate.validUntil)}`)}
        </>
      ) : (
        <Text variant="caption" color="textSecondary">{certificate === undefined ? '…' : t('browserDevtools.securityNone')}</Text>
      )}
      {network ? (
        <Text variant="bodySmall" color={network.mixed > 0 ? 'warning' : 'textSecondary'} style={{ textAlign: rtl.textAlign }}>
          {network.mixed > 0 ? t('browserDevtools.securityMixed', { count: network.mixed }) : t('browserDevtools.securityNoMixed')}
        </Text>
      ) : null}
    </ScrollView>
  );
});

const ScriptsSection = memo(function ScriptsSection({ tabId }: { tabId: string }) {
  'use no memo'; // Reads external state each render (subscribed above): compiled, the React Compiler cached the first read.
  const { t, rtl } = useTranslation();
  useDevtoolsVersion();
  const scripts = useUserScripts();
  const ran = getTabData(tabId).ran;
  return (
    <ScrollView contentContainerStyle={{ gap: 6 }}>
      <Text variant="label" accessibilityRole="header">{t('browserDevtools.scriptsRan')}</Text>
      {ran.length === 0 ? (
        <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>{t('browserDevtools.scriptsNoneRan')}</Text>
      ) : (
        ran.map((r) => {
          const name = scripts.find((s) => s.id === r.id)?.name ?? r.id;
          return (
            <Text key={r.id} variant="bodySmall" color={r.state === 'failed' ? 'error' : undefined} style={{ textAlign: rtl.textAlign }}>
              {r.state === 'failed' ? t('browserDevtools.scriptFailed', { name }) : name}
            </Text>
          );
        })
      )}
    </ScrollView>
  );
});

const UA_LABELS: Record<DevtoolsUaMode, TranslationKey> = {
  default: 'browserDevtools.uaDefault',
  desktop: 'browserDevtools.uaDesktop',
  iphone: 'browserDevtools.uaIphone',
  ipad: 'browserDevtools.uaIpad',
  custom: 'browserDevtools.uaCustom',
};

const DeviceSection = memo(function DeviceSection({ tabId }: { tabId: string }) {
  'use no memo'; // Reads external state each render (subscribed above): compiled, the React Compiler cached the first read.
  const { t, rtl } = useTranslation();
  useDevtoolsVersion();
  const state = getTabDevtools(tabId);
  const [custom, setCustom] = useState(state.customUa);
  return (
    <ScrollView contentContainerStyle={{ gap: 8 }}>
      <Text variant="label" accessibilityRole="header">{t('browserDevtools.deviceUa')}</Text>
      <View style={{ flexDirection: rtl.rowDirection, gap: 4, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
        {DEVTOOLS_UA_MODES.map((mode) => (
          <Chip
            key={mode}
            label={t(UA_LABELS[mode])}
            selected={state.uaMode === mode && !state.device}
            radio
            onPress={() => setTabDevtools(tabId, { ...state, uaMode: mode, device: null, customUa: mode === 'custom' ? custom : state.customUa })}
          />
        ))}
      </View>
      {state.uaMode === 'custom' ? (
        <View style={{ gap: 6 }}>
          <TextField label={t('browserDevtools.uaCustomField')} value={custom} onChangeText={setCustom} autoCapitalize="none" autoCorrect={false} />
          <Button title={t('browserDevtools.uaApply')} onPress={() => setTabDevtools(tabId, { ...state, customUa: custom })} />
        </View>
      ) : null}
      <Text variant="label" accessibilityRole="header">{t('browserDevtools.deviceSize')}</Text>
      <View style={{ flexDirection: rtl.rowDirection, gap: 4, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
        <Chip label={t('browserDevtools.deviceNone')} radio selected={!state.device} onPress={() => setTabDevtools(tabId, { ...state, device: null })} />
        {DEVICE_PRESETS.map((p) => (
          <Chip
            key={p.id}
            radio
            label={t('browserDevtools.deviceWidth', { width: p.width })}
            selected={state.device?.presetId === p.id}
            onPress={() => setTabDevtools(tabId, { ...state, device: { presetId: p.id, rotated: false } })}
          />
        ))}
      </View>
      <View style={{ flexDirection: rtl.rowDirection, gap: 4 }}>
        <Chip
          label={t('browserDevtools.deviceRotate')}
          disabled={!state.device}
          onPress={() => state.device && setTabDevtools(tabId, { ...state, device: { ...state.device, rotated: !state.device.rotated } })}
        />
        <Chip
          label={t('browserDevtools.deviceReset')}
          onPress={() => {
            setTabDevtools(tabId, { uaMode: 'default', customUa: state.customUa, device: null });
            setTimeout(() => reloadForTab(tabId), 50);
          }}
        />
      </View>
    </ScrollView>
  );
});

const Chip = memo(function Chip({
  label,
  onPress,
  selected = false,
  disabled = false,
  radio = false,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  radio?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={radio ? 'radio' : 'button'}
      accessibilityState={{ selected, disabled, ...(radio ? { checked: selected } : {}) }}
      accessibilityLabel={label}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.chip,
        {
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          backgroundColor: selected ? theme.colors.primary : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
      ]}>
      <Text variant="caption" color={selected ? 'textOnPrimary' : undefined}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  icon: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 48, minWidth: 48, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  mono: { fontFamily: 'monospace' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10 },
});
