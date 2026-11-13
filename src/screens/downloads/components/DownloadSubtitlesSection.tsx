import { memo, useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import type { SavedSubtitle } from '@modules/vidorax-media/src/subtitles.types';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { ensureSubtitleRecordsCleanup, refreshSubtitleRecord, useSubtitleRecordsStore } from '@/downloads/v2/subtitle-store';
import { subtitleExportFileName, vttToSrt } from '@/downloads/v2/subtitles';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { useDownloadsStore } from '@/store/downloads';

const NOTE_KEYS: Record<string, TranslationKey> = {
  unreadable: 'subtitles.noteUnreadable',
  gone: 'subtitles.noteGone',
  failed: 'subtitles.noteFailed',
  not_converted: 'subtitles.noteNotConverted',
};

/** While subtitles are still being fetched, Download Details looks again this often. */
const PENDING_POLL_MS = 3000;
const MAX_PENDING_POLLS = 40;

function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

export type DownloadSubtitlesSectionProps = { id: string };

/**
 * Download Details → Subtitles (H19): the languages saved beside the video, why some could not be saved, and Export
 * as .vtt or .srt. Shown only for a completed download that has (or is fetching) subtitles.
 */
export const DownloadSubtitlesSection = memo(function DownloadSubtitlesSection({ id }: DownloadSubtitlesSectionProps) {
  const { t } = useTranslation();
  const item = useDownloadsStore((s) => s.engineRowsById[id] ?? null);
  const completed = item?.status === 'COMPLETED';
  const record = useSubtitleRecordsStore((s) => s.byId[id] ?? null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!completed) {
      return undefined;
    }
    ensureSubtitleRecordsCleanup();
    let live = true;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      void refreshSubtitleRecord(id).then((next) => {
        if (live && next?.state === 'pending' && polls < MAX_PENDING_POLLS) {
          polls += 1;
          timer = setTimeout(load, PENDING_POLL_MS);
        }
      });
    };
    load();
    return () => {
      live = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [completed, id]);

  const exportSubtitle = useCallback(
    async (subtitle: SavedSubtitle, format: 'vtt' | 'srt') => {
      const engine = getV2Engine();
      const key = `${subtitle.index}:${format}`;
      if (!engine?.readSubtitle || !engine.shareSubtitleText || busy) {
        return;
      }
      setBusy(key);
      try {
        const vtt = await engine.readSubtitle(id, subtitle.index);
        const text = format === 'srt' ? vttToSrt(vtt) : vtt;
        await engine.shareSubtitleText(subtitleExportFileName(item?.title ?? '', subtitle.language, format), text);
      } catch {
        announce(t('subtitles.exportFailed'));
      } finally {
        setBusy(null);
      }
    },
    [busy, id, item?.title, t],
  );

  if (!completed || !record) {
    return null;
  }

  const noteKey = record.note ? NOTE_KEYS[record.note] : undefined;

  return (
    <Box mt={8} gap={8} testID="download-details-subtitles">
      <Text variant="label" color="textSecondary" style={{ letterSpacing: 0.5 }}>
        {t('subtitles.section')}
      </Text>
      {record.state === 'pending' ? (
        <Text variant="bodySmall" color="textSecondary" accessibilityLiveRegion="polite">
          {t('subtitles.pending')}
        </Text>
      ) : null}
      {record.subtitles.map((subtitle) => {
        const label = [subtitle.language ?? t('subtitles.unknownLanguage'), subtitle.name].filter(Boolean).join(' · ');
        return (
          <Box key={subtitle.index} gap={6} testID={`download-details-subtitle-${subtitle.index}`}>
            <Text variant="body">{label}</Text>
            <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }}>
              {(['vtt', 'srt'] as const).map((format) => (
                <Button
                  key={format}
                  title={format === 'vtt' ? t('subtitles.exportVtt') : t('subtitles.exportSrt')}
                  variant="outline"
                  size="small"
                  leftIcon="export-variant"
                  loading={busy === `${subtitle.index}:${format}`}
                  disabled={busy !== null}
                  onPress={() => void exportSubtitle(subtitle, format)}
                  accessibilityLabel={t('subtitles.exportA11y', { language: label, format: format.toUpperCase() })}
                  testID={`download-details-subtitle-${subtitle.index}-${format}`}
                />
              ))}
            </Box>
          </Box>
        );
      })}
      {record.state !== 'pending' && (record.failed > 0 || record.subtitles.length === 0) && noteKey ? (
        <Text variant="caption" color="textSecondary">
          {t(noteKey, { count: String(record.failed) })}
        </Text>
      ) : null}
    </Box>
  );
});
