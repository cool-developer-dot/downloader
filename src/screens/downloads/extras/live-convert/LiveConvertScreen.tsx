import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { DsCard, DsHeader, DsIcon, DsProgressBar, DsRow, DsRowGroup, DsScreen, DsSectionLabel, DsText } from '@/design';
import { AFTER_DOWNLOAD_ACTIONS, type AfterDownloadAction } from '@/downloads/v2/after-download';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { editAvailability, type EditSource } from '@/media-edit/edit-plan';
import { getEditPort } from '@/media-edit/edit-port';
import { formatFileSize } from '@/media-detection/utils/format';
import { navigation } from '@/navigation';
import { EDIT_TRIM_ROUTE } from '@/screens/downloads/components/DownloadEditActions';
import { AVAILABILITY_KEYS, useRunEdit } from '@/screens/media-edit/useRunEdit';
import { ChoiceSheet } from '@/screens/settings/browser-settings/ChoiceSheet';
import { useDownloadsStore } from '@/store/downloads';
import {
  selectAfterDownloadAction,
  selectLiveRecording,
  selectLiveRecordingMaxMinutes,
  useSettingsStore,
} from '@/store/settings';

import { formatClock, joinDots } from '../shared/format';
import { useNotYet } from '../shared/use-not-yet';
import { useSettingsHeaderAction } from '../shared/use-settings-header-action';

import { findLastCompletedEngineId, findRecordingId, recordingProgress } from './live-convert-model';

const AFTER_LABELS: Record<AfterDownloadAction, TranslationKey> = {
  none: 'afterDownload.none',
  details: 'afterDownload.details',
  play: 'afterDownload.play',
  gallery: 'afterDownload.gallery',
};

const AFTER_HINTS: Record<AfterDownloadAction, TranslationKey> = {
  none: 'afterDownload.noneHint',
  details: 'afterDownload.detailsHint',
  play: 'afterDownload.playHint',
  gallery: 'afterDownload.galleryHint',
};

/**
 * Design 41 "Live & convert": the running live recording (F6) over the after-download rows — Convert (H23, the
 * newest finished video), Compress and Metadata tagging (no setting yet), Trim (the trim editor) and the
 * Post-download action (H11).
 */
export const LiveConvertScreen = memo(function LiveConvertScreen() {
  const { t, rtl } = useTranslation();
  const notYet = useNotYet();
  const settingsAction = useSettingsHeaderAction();
  const liveRecording = useSettingsStore(selectLiveRecording);
  const maxMinutes = useSettingsStore(selectLiveRecordingMaxMinutes);
  const afterAction = useSettingsStore(selectAfterDownloadAction);
  const recordingId = useDownloadsStore(findRecordingId);
  const transfer = useDownloadsStore((s) => (recordingId ? (s.transferById[recordingId] ?? null) : null));
  const lastCompletedId = useDownloadsStore(findLastCompletedEngineId);
  const runEdit = useRunEdit();
  const [convert, setConvert] = useState<{ id: string; source: EditSource } | null>(null);
  const [afterOpen, setAfterOpen] = useState(false);

  const recordedMs = transfer?.recordedMs ?? 0;
  const statusLine = recordingId
    ? joinDots([formatClock(recordedMs), formatFileSize(transfer?.bytesWritten)])
    : liveRecording
      ? t('lightLiveConvert.noLiveRecording')
      : t('lightLiveConvert.liveRecordingOff');

  const openConvert = useCallback(async () => {
    const engine = getV2Engine();
    if (!lastCompletedId || !engine || !getEditPort()) {
      notYet();
      return;
    }
    try {
      const source = await engine.getLibraryItem(lastCompletedId);
      if (!source) {
        notYet();
        return;
      }
      setConvert({ id: lastCompletedId, source });
    } catch {
      notYet();
    }
  }, [lastCompletedId, notYet]);

  const convertActions = useMemo<ActionSheetItem[]>(() => {
    if (!convert) {
      return [];
    }
    return (['mp4', 'audio'] as const).map((kind) => {
      const availability = editAvailability(kind, convert.source);
      const label = kind === 'mp4' ? t('mediaEdit.convertMp4') : t('mediaEdit.convertAudio');
      return {
        id: `convert-${kind}`,
        label: availability === 'ok' ? label : `${label} — ${t(AVAILABILITY_KEYS[availability])}`,
        onPress: () => {
          setConvert(null);
          if (availability === 'ok') {
            void runEdit(convert.id, kind);
          }
        },
      };
    });
  }, [convert, runEdit, t]);

  const openTrim = useCallback(() => {
    if (!lastCompletedId || !getEditPort()) {
      notYet();
      return;
    }
    navigation.push({ pathname: EDIT_TRIM_ROUTE, params: { id: lastCompletedId } });
  }, [lastCompletedId, notYet]);

  const afterOptions = useMemo(
    () =>
      AFTER_DOWNLOAD_ACTIONS.map((value) => ({
        value,
        label: t(AFTER_LABELS[value]),
        description: t(AFTER_HINTS[value]),
      })),
    [t],
  );

  const chooseAfter = useCallback((value: AfterDownloadAction) => {
    useSettingsStore.getState().updateSetting('afterDownloadAction', value);
  }, []);

  return (
    <DsScreen testID="live-convert-screen">
      <DsHeader title={t('lightLiveConvert.title')} action={settingsAction} />

      <DsCard testID="live-convert-recording">
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
          <DsIcon name="circle-dot" size={18} color="textPrimary" strokeWidth={1.8} />
          <DsText variant="cardTitle" numberOfLines={1} style={{ flex: 1 }}>
            {t('lightLiveConvert.recLiveStream')}
          </DsText>
        </View>
        <DsText variant="body" color="textPrimary" numberOfLines={1} style={{ marginTop: 4 }} testID="live-convert-status">
          {statusLine}
        </DsText>
        <DsProgressBar
          progress={recordingId ? recordingProgress(recordedMs, maxMinutes) : 0}
          accessibilityLabel={t('lightLiveConvert.recordingA11y')}
          style={{ marginTop: 12 }}
        />
      </DsCard>

      <DsSectionLabel>{t('lightLiveConvert.afterDownload')}</DsSectionLabel>
      <DsRowGroup testID="live-convert-rows">
        <DsRow
          icon="refresh-cw"
          title={t('lightLiveConvert.convertTo')}
          subtitle={t('lightLiveConvert.convertToFormats')}
          onPress={() => void openConvert()}
          testID="live-convert-convert"
        />
        <DsRow
          icon="archive"
          title={t('lightLiveConvert.compress')}
          toggle={{ value: false, onValueChange: notYet }}
          testID="live-convert-compress"
        />
        <DsRow
          icon="tag"
          title={t('lightLiveConvert.metadataTagging')}
          toggle={{ value: false, onValueChange: notYet }}
          testID="live-convert-metadata"
        />
        <DsRow
          icon="scissors"
          title={t('lightLiveConvert.trimDownload')}
          subtitle={t('common.off')}
          onPress={openTrim}
          testID="live-convert-trim"
        />
        <DsRow
          icon="gauge"
          title={t('lightLiveConvert.postDownloadAction')}
          subtitle={t(AFTER_LABELS[afterAction])}
          onPress={() => setAfterOpen(true)}
          testID="live-convert-post-action"
        />
      </DsRowGroup>

      <ActionSheetModal
        visible={convert != null}
        onClose={() => setConvert(null)}
        title={t('mediaEdit.convertTitle')}
        subtitle={t('mediaEdit.convertSubtitle')}
        actions={convertActions}
        testID="live-convert-convert-sheet"
      />
      <ChoiceSheet
        visible={afterOpen}
        title={t('lightLiveConvert.postDownloadAction')}
        options={afterOptions}
        value={afterAction}
        onSelect={chooseAfter}
        onClose={() => setAfterOpen(false)}
        testID="live-convert-post-action-sheet"
      />
    </DsScreen>
  );
});
