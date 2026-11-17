import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { DsButton, DsChip, DsChipRow, DsHeader, DsIcon, DsRow, DsRowGroup, DsScreen, DsText, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { batchRowLabel, useBatchAdd, type BatchRow } from '@/screens/batch-add';
import { ChoiceSheet, type ChoiceOption } from '@/screens/settings/browser-settings/ChoiceSheet';

const COOLDOWN_CHOICES = ['0', '2', '5', '10'] as const;
type CooldownChoice = (typeof COOLDOWN_CHOICES)[number];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

/** The design's check tile: the accent tile with a check for a selected video, an empty square otherwise. */
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
      <DsIcon name={checked ? 'check' : 'square'} size={checked ? ds.size.rowIcon : 14} color="primary" strokeWidth={2} />
    </View>
  );
});

/**
 * Design 40 "Playlist download": the links handed over by Add download (the Playlist chip, or the Link Grabber's
 * prefill) as a selectable list, started through Batch Add (#292) one by one with the chosen cooldown.
 */
export const PlaylistScreen = memo(function PlaylistScreen() {
  const { t } = useTranslation();
  const batch = useBatchAdd();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState<'all' | 'selected'>('all');
  const [cooldown, setCooldown] = useState<CooldownChoice>('0');
  const [cooldownSheet, setCooldownSheet] = useState(false);
  const [qualitySheet, setQualitySheet] = useState(false);

  const items = batch.links;
  const selected = useMemo(() => items.filter((url) => !excluded.has(url)), [excluded, items]);
  const shown = filter === 'all' ? items : selected;
  const rowsByUrl = useMemo(() => new Map(batch.rows.map((row) => [row.url, row])), [batch.rows]);

  const goBack = useCallback(() => navigation.back(), []);
  const openSettings = useCallback(() => navigation.push(routePaths.downloadSettings), []);

  const toggle = useCallback((url: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }, []);

  const start = useCallback(() => {
    void batch.start({ links: selected, cooldownMs: Number(cooldown) * 1000 });
  }, [batch, cooldown, selected]);

  const cooldownOptions = useMemo<ChoiceOption<CooldownChoice>[]>(
    () => COOLDOWN_CHOICES.map((value) => ({ value, label: t('lightPlaylist.cooldownValue', { seconds: value }) })),
    [t],
  );
  const qualityOptions = useMemo<ChoiceOption<'best'>[]>(
    () => [{ value: 'best', label: t('lightPlaylist.qualityBest'), description: t('lightPlaylist.qualityBestHint') }],
    [t],
  );

  const subtitleOf = (url: string, row: BatchRow | undefined): string => (row ? batchRowLabel(row, t) : hostOf(url));

  return (
    <DsScreen
      testID="playlist-screen"
      footer={
        batch.running ? (
          <DsButton label={t('linkIntake.stop')} variant="secondary" fullWidth onPress={batch.stop} testID="playlist-stop" />
        ) : (
          <DsButton
            label={t('lightPlaylist.download', { count: selected.length })}
            fullWidth
            onPress={start}
            disabled={selected.length === 0}
            accessibilityHint={t('lightPlaylist.downloadHint')}
            testID="playlist-download"
          />
        )
      }>
      <DsHeader
        title={t('lightPlaylist.title')}
        subtitle={t('lightPlaylist.videos', { count: items.length })}
        onBack={goBack}
        action={{ icon: 'settings', accessibilityLabel: t('lightPlaylist.settingsA11y'), onPress: openSettings, testID: 'playlist-settings' }}
        testID="playlist-header"
      />
      <DsChipRow testID="playlist-chips">
        <DsChip label={t('lightPlaylist.all')} selected={filter === 'all'} onPress={() => setFilter('all')} testID="playlist-chip-all" />
        <DsChip
          label={t('lightPlaylist.selected', { count: selected.length })}
          selected={filter === 'selected'}
          onPress={() => setFilter('selected')}
          testID="playlist-chip-selected"
        />
      </DsChipRow>
      {shown.length > 0 ? (
        <DsRowGroup testID="playlist-items">
          {shown.map((url) => {
            const row = rowsByUrl.get(url);
            const checked = !excluded.has(url);
            return (
              <DsRow
                key={url}
                leading={<CheckTile checked={checked} />}
                title={row?.result?.title || hostOf(url)}
                subtitle={subtitleOf(url, row)}
                onPress={() => toggle(url)}
                disabled={batch.running}
                accessibilityLabel={`${row?.result?.title || url}, ${subtitleOf(url, row)}`}
                accessibilityHint={checked ? t('lightPlaylist.unselectHint') : t('lightPlaylist.selectHint')}
                testID={`playlist-item-${url}`}
              />
            );
          })}
        </DsRowGroup>
      ) : (
        <DsText variant="body">{t('lightPlaylist.empty')}</DsText>
      )}
      <DsRowGroup testID="playlist-options">
        <DsRow
          icon="film"
          title={t('lightPlaylist.qualityForAll')}
          subtitle={t('lightPlaylist.qualityBest')}
          onPress={() => setQualitySheet(true)}
          testID="playlist-quality"
        />
        <DsRow icon="file-text" title={t('lightPlaylist.dataEstimate')} subtitle="—" trailing="chevron" testID="playlist-estimate" />
        <DsRow
          icon="circle"
          title={t('lightPlaylist.cooldown')}
          subtitle={t('lightPlaylist.cooldownValue', { seconds: cooldown })}
          onPress={() => setCooldownSheet(true)}
          accessibilityHint={t('lightPlaylist.cooldownHint')}
          testID="playlist-cooldown"
        />
      </DsRowGroup>
      <ChoiceSheet<CooldownChoice>
        visible={cooldownSheet}
        title={t('lightPlaylist.cooldown')}
        options={cooldownOptions}
        value={cooldown}
        onSelect={setCooldown}
        onClose={() => setCooldownSheet(false)}
        testID="playlist-cooldown-choice"
      />
      <ChoiceSheet<'best'>
        visible={qualitySheet}
        title={t('lightPlaylist.qualityForAll')}
        options={qualityOptions}
        value="best"
        onSelect={() => undefined}
        onClose={() => setQualitySheet(false)}
        testID="playlist-quality-choice"
      />
    </DsScreen>
  );
});
