import { memo, useEffect, useMemo, useState } from 'react';

import { DsButton, DsCard, DsChip, DsChipRow, DsIcon, DsRow, DsRowGroup, DsSectionLabel, DsText } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import { formatFileSize } from '@/media-detection/utils/format';
import { compressOptions, compressResolutionLabel, type CompressPreset } from '@/media-edit/compress-plan';
import { editAvailability, type EditAvailability } from '@/media-edit/edit-plan';
import { AVAILABILITY_KEYS } from '@/screens/media-edit/useRunEdit';

import type { PlayerEditToolsSheetsState } from '../page/use-player-edit-tools';
import { PlayerDesignPage } from './PlayerDesignPage';

export type ConvertTab = 'convert' | 'compress' | 'extract' | 'merge';

const TABS: readonly { id: ConvertTab; label: TranslationKey }[] = [
  { id: 'convert', label: 'playerDesign.tabConvert' },
  { id: 'compress', label: 'playerDesign.tabCompress' },
  { id: 'extract', label: 'playerDesign.tabExtract' },
  { id: 'merge', label: 'playerDesign.tabMerge' },
];

const PRESET_LABELS: Readonly<Record<CompressPreset, TranslationKey>> = {
  high: 'videoPlayer.compressHigh',
  medium: 'videoPlayer.compressMedium',
  small: 'videoPlayer.compressSmall',
};

export type ConvertPageProps = {
  visible: boolean;
  /** The tab the Video tools tile asked for. */
  tab: ConvertTab;
  videoTitle: string | null;
  /** P10's converter and compress choices (the same item and actions as its sheets). */
  edit: PlayerEditToolsSheetsState;
  extractAudio: (() => void) | null;
  /** P12: Merge and Change speed open their own sheets. */
  openMerge: (() => void) | null;
  openSpeed: (() => void) | null;
  onBack: () => void;
  onSettings: () => void;
};

/**
 * Design 54 "Convert & compress": Convert (MP4 video or audio only, and Speed), Compress (High / Medium / Small with the
 * size each copy will have), Extract audio and Merge — P10's and P12's edits, each saving a new copy. The design's
 * Watermark is a feature the owner set as Not planned. Start closes the page; the edit's progress shows over the video.
 */
export const ConvertPage = memo(function ConvertPage({
  visible,
  tab: initialTab,
  videoTitle,
  edit,
  extractAudio,
  openMerge,
  openSpeed,
  onBack,
  onSettings,
}: ConvertPageProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ConvertTab>(initialTab);
  const [format, setFormat] = useState<'mp4' | 'audio'>('mp4');
  const source = edit.item;
  const options = useMemo(() => (source ? compressOptions(source) : []), [source]);
  const firstPreset = options.find((option) => option.availability === 'ok')?.preset ?? null;
  const [preset, setPreset] = useState<CompressPreset | null>(firstPreset);

  useEffect(() => {
    if (visible) {
      setTab(initialTab);
    }
  }, [initialTab, visible]);
  useEffect(() => {
    setPreset(firstPreset);
  }, [firstPreset]);

  const run = (action: () => void) => {
    onBack();
    requestAnimationFrame(action);
  };

  // Nothing is drawn while hidden, and nothing is worked out without the library item (it loads with the video).
  if (!visible) {
    return null;
  }
  const formatAvailability = (kind: 'mp4' | 'audio'): EditAvailability | null =>
    source ? editAvailability(kind, source) : null;
  const availabilityHint = (availability: EditAvailability | null): string | undefined =>
    availability && availability !== 'ok' ? t(AVAILABILITY_KEYS[availability]) : undefined;
  const nowSize = source ? (formatFileSize(source.sizeBytes) ?? '') : '';
  const nowResolution =
    source && typeof source.width === 'number' && typeof source.height === 'number'
      ? compressResolutionLabel(Math.min(source.width, source.height))
      : null;

  let body: React.ReactNode = null;
  // The format picked, or the first one this video can take; none when it can take neither.
  const chosenFormat: 'mp4' | 'audio' | null =
    formatAvailability(format) === 'ok' ? format : (['mp4', 'audio'] as const).find((kind) => formatAvailability(kind) === 'ok') ?? null;
  if (tab === 'convert') {
    const canStart = chosenFormat != null;
    body = (
      <>
        <DsSectionLabel first>{t('playerDesign.sectionFormat')}</DsSectionLabel>
        <DsRowGroup testID="player-convert-formats">
          {(['mp4', 'audio'] as const).map((kind) => {
            const availability = formatAvailability(kind);
            return (
              <DsRow
                key={kind}
                icon={kind === 'mp4' ? 'film' : 'music'}
                title={kind === 'mp4' ? t('mediaEdit.convertMp4') : t('mediaEdit.convertAudio')}
                subtitle={availabilityHint(availability)}
                trailing={chosenFormat === kind ? <DsIcon name="check" size={18} color="primary" /> : 'none'}
                disabled={availability !== 'ok'}
                onPress={() => setFormat(kind)}
                accessibilityLabel={`${kind === 'mp4' ? t('mediaEdit.convertMp4') : t('mediaEdit.convertAudio')}${
                  chosenFormat === kind ? `, ${t('common.selected')}` : ''
                }`}
                testID={`player-convert-${kind}`}
              />
            );
          })}
          {openSpeed ? (
            <DsRow
              icon="gauge"
              title={t('playerDesign.rowSpeed')}
              subtitle={t('playerDesign.rowSpeedSub')}
              onPress={() => run(openSpeed)}
              testID="player-convert-speed"
            />
          ) : null}
        </DsRowGroup>
        <DsButton
          label={t('playerDesign.start')}
          fullWidth
          disabled={!canStart}
          onPress={() => chosenFormat && run(() => edit.onConvert(chosenFormat))}
          testID="player-convert-start"
        />
      </>
    );
  } else if (tab === 'compress') {
    body = (
      <>
        <DsText variant="rowSub">
          {nowResolution
            ? t('videoPlayer.compressNowWithSize', { size: nowSize, resolution: nowResolution })
            : t('videoPlayer.compressNow', { size: nowSize })}
        </DsText>
        <DsRowGroup testID="player-compress-presets">
          {options.map((option) => {
            const size = formatFileSize(option.estimateBytes) ?? '';
            const resolution = compressResolutionLabel(option.shortSide);
            const detail = resolution
              ? t('videoPlayer.compressPresetDetail', { resolution, size })
              : t('videoPlayer.compressPresetSize', { size });
            const available = option.availability === 'ok';
            return (
              <DsRow
                key={option.preset}
                icon="archive"
                title={t(PRESET_LABELS[option.preset])}
                subtitle={available ? detail : `${detail} · ${t('videoPlayer.compressNoGain')}`}
                trailing={preset === option.preset ? <DsIcon name="check" size={18} color="primary" /> : 'none'}
                disabled={!available}
                onPress={() => setPreset(option.preset)}
                accessibilityLabel={`${t(PRESET_LABELS[option.preset])}${preset === option.preset ? `, ${t('common.selected')}` : ''}`}
                testID={`player-compress-${option.preset}`}
              />
            );
          })}
        </DsRowGroup>
        <DsText variant="rowSub">{t('videoPlayer.compressEstimateNote')}</DsText>
        <DsButton
          label={t('playerDesign.start')}
          fullWidth
          disabled={preset == null}
          onPress={() => preset && run(() => edit.onCompress(preset))}
          testID="player-compress-start"
        />
      </>
    );
  } else {
    const action = tab === 'extract' ? extractAudio : openMerge;
    body = (
      <>
        <DsCard>
          <DsText variant="body">
            {t(tab === 'extract' ? 'videoPlayer.extractAudioHint' : 'videoPlayer.mergeVideosHint')}
          </DsText>
        </DsCard>
        <DsButton
          label={t('playerDesign.start')}
          fullWidth
          disabled={!action}
          onPress={() => action && run(action)}
          testID={`player-${tab}-start`}
        />
      </>
    );
  }

  return (
    <PlayerDesignPage
      visible={visible}
      title={t('playerDesign.convertTitle')}
      subtitle={videoTitle ?? undefined}
      onBack={onBack}
      onSettings={onSettings}
      testID="player-convert-page">
      <DsChipRow testID="player-convert-tabs">
        {TABS.map((entry) => (
          <DsChip
            key={entry.id}
            label={t(entry.label)}
            selected={tab === entry.id}
            onPress={() => setTab(entry.id)}
            testID={`player-convert-tab-${entry.id}`}
          />
        ))}
      </DsChipRow>
      {body}
    </PlayerDesignPage>
  );
});
