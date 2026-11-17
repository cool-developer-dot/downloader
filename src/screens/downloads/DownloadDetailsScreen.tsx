import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Share, ToastAndroid, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { Button } from '@/components/buttons/Button';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { AppModal } from '@/components/modals/AppModal';
import { TextField } from '@/components/inputs/TextField';
import {
  DsButton,
  DsButtonRow,
  DsCard,
  DsHeader,
  DsProgressBar,
  DsRow,
  DsRowGroup,
  DsScreen,
  DsSectionLabel,
  DsText,
} from '@/design';
import { useDownloadBandwidth } from '@/downloads/v2/bandwidth';
import { fileIntegrity, mayPlayWhileDownloading } from '@/downloads/v2/file-integrity';
import { formatRecordedTime } from '@/downloads/v2/live-recording';
import { formatWhen } from '@/downloads/v2/conditions';
import { getV2Engine, isEngineOwned, renameEngineLibraryItem } from '@/downloads/v2';
import { getEditPort } from '@/media-edit/edit-port';
import { normalizeConnectionsPerFile } from '@/downloads/v2/settings';
import { normalizeSpeedLimit, SPEED_LIMIT_CHOICES, speedLimitLabel } from '@/downloads/v2/speed-limit';
import { showInFolderTarget } from '@/downloads/v2/save-location';
import { useExternalCopiesStore } from '@/downloads/v2/save-location-store';
import { renameMediaFileOnDevice } from '@/downloads/engine';
import { useTheme } from '@/hooks/use-theme';
import { UNFILED_FOLDER_SELECTION_ID } from '@/library/constants';
import { useTranslation } from '@/localization';
import { formatDuration } from '@/media-detection/utils';
import { navigation, openPlayer, routePaths } from '@/navigation';
import { ChoiceSheet } from '@/screens/settings/browser-settings/ChoiceSheet';
import { CONNECTION_SEGMENT_OPTIONS } from '@/screens/settings/download-settings/constants';
import { useNotAvailableYet } from '@/screens/settings/download-settings/light/useNotAvailableYet';
import { FILE_UNAVAILABLE_SUPPORT_CONTEXT, getDownloadSupportContext } from '@/support';
import { openSupportWithContext } from '@/support/support-navigation';
import type { DownloadItem } from '@/store/downloads';
import { useDownloadsStore } from '@/store/downloads';
import { useFoldersStore } from '@/store/organization/folders';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';
import { selectConnectionsPerFile, useSettingsStore } from '@/store/settings';

import { DownloadBandwidthControls } from './components/DownloadBandwidthControls';
import { DownloadDeleteDialog } from './components/DownloadDeleteDialog';
import { DownloadDetailsSkeleton } from './components/DownloadDetailsSkeleton';
import { DownloadEditActions } from './components/DownloadEditActions';
import { DownloadIntegritySection } from './components/DownloadIntegritySection';
import { DownloadMoveToPrivateAction } from './components/DownloadMoveToPrivateAction';
import { DownloadProgressDetailsRows, DownloadSegmentBars } from './components/DownloadProgressDetailsRows';
import { DownloadSaveLocationAction } from './components/DownloadSaveLocationAction';
import { DownloadStartAtControl } from './components/DownloadStartAtControl';
import { DownloadSubtitlesSection } from './components/DownloadSubtitlesSection';
import { DownloadTagsAndNote } from './components/DownloadTagsAndNote';
import { useDownloadDetailsScreen } from './hooks/useDownloadDetailsScreen';
import { useDownloadLinkActions, useDownloadLinkTarget } from './hooks/useDownloadLinkActions';
import { useDownloadProgressDetails } from './hooks/useDownloadProgressDetails';
import { useCanSaveThumbnail, useSaveThumbnail } from './hooks/useSaveThumbnail';
import {
  extractMediaType,
  formatDownloadDate,
  formatDownloadFileSize,
  formatDownloadedBytes,
  formatDurableBitrate,
  formatDurableResolution,
  formatEtaSeconds,
  formatPlatform,
  formatSourceHost,
  formatTransferSpeed,
  getExecutionStatusLabel,
  recordingLabelFor,
  sanitizeErrorMessage,
  waitingLabelFor,
  type DownloadCardAction,
} from './utils/download-format';

const PRIMARY_LABEL_KEYS: Record<
  DownloadCardAction,
  | 'downloads.primaryStop'
  | 'downloads.primaryPause'
  | 'downloads.primaryResume'
  | 'downloads.primaryCancel'
  | 'downloads.primaryRetry'
  | 'downloads.primaryOpen'
  | 'downloads.primaryShare'
  | 'downloads.primaryRemove'
> = {
  stop: 'downloads.primaryStop',
  pause: 'downloads.primaryPause',
  resume: 'downloads.primaryResume',
  cancel: 'downloads.primaryCancel',
  retry: 'downloads.primaryRetry',
  open: 'downloads.primaryOpen',
  share: 'downloads.primaryShare',
  remove: 'downloads.primaryRemove',
};

const LIVE_STATUSES = new Set(['DOWNLOADING', 'PAUSED', 'QUEUED']);

type Panel = 'integrity' | 'organize' | 'startAt' | 'subtitles' | 'edit' | 'info' | null;
type Sheet = 'priority' | 'connections' | 'limit' | 'links' | null;

/** "Format · MP4" lines of the Info panel. */
const InfoRow = memo(function InfoRow({ label, value, accessibilityLabel }: { label: string; value: string; accessibilityLabel?: string }) {
  const theme = useTheme();
  const { rtl } = useTranslation();
  return (
    <View
      style={{
        flexDirection: rtl.rowDirection,
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
      }}
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}>
      <DsText variant="rowSub">{label}</DsText>
      <View style={{ flex: 1, minWidth: 0 }}>
        <DsText variant="rowValue" color="textPrimary" numberOfLines={2} align={rtl.isRtl ? 'left' : 'right'}>
          {value}
        </DsText>
      </View>
    </View>
  );
});

/** A failed / unavailable / retrying notice as a design card with the existing "Get help" path. */
const NoticeCard = memo(function NoticeCard({
  title,
  body,
  onHelp,
  testID,
}: {
  title: string;
  body: string;
  onHelp?: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  return (
    <DsCard testID={testID}>
      <View accessible accessibilityLabel={`${title}. ${body}`} style={{ gap: 4 }}>
        <DsText variant="bodyStrong" color="primary">
          {title}
        </DsText>
        <DsText variant="body">{body}</DsText>
      </View>
      {onHelp ? (
        <DsButton
          label={t('support.getHelp')}
          variant="secondary"
          onPress={onHelp}
          fullWidth
          accessibilityLabel={t('support.getHelpA11y')}
          accessibilityHint={t('support.getHelpHint')}
          style={{ marginTop: 12 }}
        />
      ) : null}
    </DsCard>
  );
});

type DetailsBodyProps = {
  item: DownloadItem;
  mutating: boolean;
  actionError: string | null;
  primaryAction: DownloadCardAction | null;
  secondaryActions: DownloadCardAction[];
  canUseLocalFile: boolean;
  isFavorited: boolean;
  favoritePending: boolean;
  folderLabel: string;
  onOpenFolderPicker: () => void;
  onRename: () => void;
  onFavorite: () => void;
  onPlay: () => void;
  onPrimary: () => void;
  onSecondary: (action: DownloadCardAction) => void;
};

const DetailsBody = memo(function DetailsBody({
  item,
  mutating,
  actionError,
  primaryAction,
  secondaryActions,
  canUseLocalFile,
  isFavorited,
  favoritePending,
  folderLabel,
  onOpenFolderPicker,
  onRename,
  onFavorite,
  onPlay,
  onPrimary,
  onSecondary,
}: DetailsBodyProps) {
  const { t, language } = useTranslation();
  const notYet = useNotAvailableYet();
  const transfer = useDownloadsStore((s) => s.transferById[item.id] ?? null);
  const engineOwned = useDownloadsStore((s) => isEngineOwned(s, item.id));
  const wifiOnly = useSettingsStore((s) => s.wifiOnly);
  const connectionsPerFile = normalizeConnectionsPerFile(useSettingsStore(selectConnectionsPerFile));
  const copyRecord = useExternalCopiesStore((s) => s.records[item.id]);
  const details = useDownloadProgressDetails(item.id);
  const bandwidth = useDownloadBandwidth(item.id);
  const linkTarget = useDownloadLinkTarget(item.id);
  const { redownload, copyLink } = useDownloadLinkActions();
  const canSaveThumbnail = useCanSaveThumbnail(item.id);
  const saveThumbnail = useSaveThumbnail();
  const [panel, setPanel] = useState<Panel>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [savingThumbnail, setSavingThumbnail] = useState(false);
  const closeSheet = useCallback(() => setSheet(null), []);
  const togglePanel = useCallback((next: Exclude<Panel, null>) => setPanel((current) => (current === next ? null : next)), []);

  const completed = item.status === 'COMPLETED';
  const live = LIVE_STATUSES.has(item.status);
  const showInternalPlay = completed && canUseLocalFile;
  // F6: a live recording shows its length and size so far instead of a percentage.
  const recordingLine = item.status === 'DOWNLOADING' ? recordingLabelFor(transfer) : null;
  const statusLabel = recordingLine
    ? t('downloads.statusRecording')
    : getExecutionStatusLabel({
        status: item.status,
        workerState: item.workerState,
        downloadId: item.id,
        processingStage: transfer?.processingStage ?? null,
        // The engine holds it for a network it may use: "Waiting for Wi-Fi" / "Waiting for network", not "Queued".
        ...(transfer?.waitingNetwork ? { waitingReason: wifiOnly ? 'WAITING_FOR_WIFI' : 'OFFLINE' } : {}),
      });
  const progressPercent = transfer?.progress != null ? transfer.progress : item.progress;
  const knownTotalBytes =
    transfer?.totalBytes != null && transfer.totalBytes > 0
      ? transfer.totalBytes
      : Number(item.fileSize) > 0
        ? Number(item.fileSize)
        : null;
  const totalSize = knownTotalBytes != null ? formatDownloadFileSize(String(knownTotalBytes)) : null;
  const downloadedSize =
    transfer?.bytesWritten != null && transfer.bytesWritten > 0
      ? formatDownloadFileSize(String(transfer.bytesWritten))
      : knownTotalBytes != null
        ? formatDownloadedBytes(item.fileSize, item.progress)
        : null;
  const speedLabel = item.status === 'DOWNLOADING' || item.status === 'PAUSED' ? formatTransferSpeed(transfer?.bytesPerSecond ?? null) : null;
  const etaLabel = item.status === 'DOWNLOADING' || item.status === 'PAUSED' ? formatEtaSeconds(transfer?.etaSeconds ?? null) : null;
  const waitingLabel = waitingLabelFor(transfer);
  const qualityLabel = typeof item.quality === 'string' && item.quality.trim() ? item.quality.trim() : null;
  const progressFraction = Math.min(1, Math.max(0, progressPercent / 100));
  const heroPercent =
    knownTotalBytes == null && !completed && progressPercent <= 0 ? '—' : `${Math.round(completed ? 100 : progressPercent)}%`;

  // "8.4 MB/s · 14.6 MB of 23.5 MB left 8.9 MB": the design's one line, from what is known.
  const heroLine = useMemo(() => {
    if (recordingLine) {
      return recordingLine;
    }
    const speed = item.status === 'DOWNLOADING' ? speedLabel ?? '—' : speedLabel;
    if (speed && downloadedSize && totalSize && details.remaining) {
      return t('lightDetails.heroLine', { speed, done: downloadedSize, total: totalSize, remaining: details.remaining });
    }
    const parts = [
      speed,
      downloadedSize && totalSize ? t('lightDetails.doneOfTotal', { done: downloadedSize, total: totalSize }) : downloadedSize ?? totalSize,
      etaLabel,
    ].filter((part): part is string => Boolean(part));
    return parts.join(' · ');
  }, [details.remaining, downloadedSize, etaLabel, item.status, recordingLine, speedLabel, t, totalSize]);

  const startAtLabel =
    transfer?.startAt != null && transfer.startAt > Date.now() ? formatWhen(transfer.startAt, Date.now(), language) : t('lightDetails.startNow');
  const startAtAvailable = typeof getV2Engine()?.setDownloadStartAt === 'function';
  const integrityAvailable =
    Boolean(fileIntegrity()) &&
    (completed || (engineOwned && (item.status === 'FAILED' || mayPlayWhileDownloading(item.status, item.workerState))));
  const editAvailable = Boolean(getEditPort()) && completed && engineOwned;
  const copyTarget = showInFolderTarget(copyRecord);

  const speedLimitText = useCallback(
    (value: number) => {
      const label = speedLimitLabel(value);
      return label.kind === 'off'
        ? t('settings.speedLimitOff')
        : t(label.kind === 'mb' ? 'settings.speedLimitMb' : 'settings.speedLimitKb', { value: label.value });
    },
    [t],
  );
  const priorityOptions = useMemo(
    () => [
      { value: 'normal', label: t('lightDetails.priorityNormal') },
      { value: 'high', label: t('lightDetails.priorityHigh'), description: t('lightDetails.priorityHint') },
    ],
    [t],
  );
  const connectionOptions = useMemo(() => CONNECTION_SEGMENT_OPTIONS.map((option) => ({ value: option.value, label: option.label })), []);
  const limitOptions = useMemo(() => SPEED_LIMIT_CHOICES.map((value) => ({ value: String(value), label: speedLimitText(value) })), [speedLimitText]);

  const requireUnfinishedBandwidth = useCallback(
    (next: Exclude<Sheet, 'links' | 'connections' | null>) => {
      if (!live) {
        ToastAndroid.show(t('lightDetails.unfinishedOnly'), ToastAndroid.SHORT);
        return;
      }
      if (!bandwidth.available) {
        notYet();
        return;
      }
      setSheet(next);
    },
    [bandwidth.available, live, notYet, t],
  );
  const requireCompleted = useCallback(
    (next: Exclude<Panel, null>, available = true) => {
      if (!completed) {
        ToastAndroid.show(t('lightDetails.finishedOnly'), ToastAndroid.SHORT);
        return;
      }
      if (!available) {
        notYet();
        return;
      }
      togglePanel(next);
    },
    [completed, notYet, t, togglePanel],
  );

  const onSaveThumbnail = useCallback(() => {
    if (!canSaveThumbnail) {
      ToastAndroid.show(completed ? t('common.notAvailableYet') : t('lightDetails.finishedOnly'), ToastAndroid.SHORT);
      return;
    }
    setSavingThumbnail(true);
    void saveThumbnail(item.id).finally(() => setSavingThumbnail(false));
  }, [canSaveThumbnail, completed, item.id, saveThumbnail, t]);

  const shareUrl = linkTarget?.copyUrl ?? (item.sourceUrl?.trim() || null);
  const linkActions = useMemo<ActionSheetItem[]>(() => {
    if (!shareUrl) {
      return [];
    }
    const target = linkTarget ?? { pageUrl: null, copyUrl: shareUrl };
    const actions: ActionSheetItem[] = [];
    if (target.pageUrl) {
      actions.push({ id: 'redownload', label: t('downloadLinks.redownload'), icon: 'refresh', onPress: () => void redownload(target) });
    }
    actions.push({ id: 'copy', label: t('downloadLinks.copyLink'), icon: 'content-copy', onPress: () => void copyLink(target) });
    actions.push({
      id: 'share',
      label: t('lightDetails.shareLink'),
      icon: 'share-variant',
      onPress: () => void Share.share({ message: target.copyUrl }).catch(() => undefined),
    });
    return actions.map((action) => ({
      ...action,
      onPress: () => {
        setSheet(null);
        action.onPress?.();
      },
    }));
  }, [copyLink, linkTarget, redownload, shareUrl, t]);
  const openLinks = useCallback(() => {
    if (!shareUrl) {
      ToastAndroid.show(t('lightDetails.noLinkYet'), ToastAndroid.SHORT);
      return;
    }
    setSheet('links');
  }, [shareUrl, t]);

  // The primary action then its siblings, two to a row as the kit draws them.
  const buttons = useMemo(() => {
    const all: { action: DownloadCardAction | 'play'; primary: boolean }[] = [];
    if (showInternalPlay) {
      all.push({ action: 'play', primary: true });
    } else if (primaryAction) {
      all.push({ action: primaryAction, primary: true });
    }
    if (!showInternalPlay) {
      for (const action of secondaryActions) {
        all.push({ action, primary: false });
      }
    }
    const rows: (typeof all)[] = [];
    for (let i = 0; i < all.length; i += 2) {
      rows.push(all.slice(i, i + 2));
    }
    return rows;
  }, [primaryAction, secondaryActions, showInternalPlay]);

  const mediaType = extractMediaType(item.fileName);
  const platform = formatPlatform(item.platform);
  const resolutionLabel = formatDurableResolution(item.resolution);
  const bitrateLabel = formatDurableBitrate(item.bitrate);
  const durationLabel = formatDuration(
    typeof (item as { duration?: unknown }).duration === 'number' && Number.isFinite((item as { duration?: number }).duration)
      ? ((item as { duration?: number }).duration as number)
      : null,
  );
  const retryLabel = typeof item.retryCount === 'number' && item.retryCount > 0 ? String(item.retryCount) : null;
  const localAvailability =
    transfer?.localState === 'missing'
      ? t('downloads.missingOnDevice')
      : transfer?.localState === 'complete'
        ? t('downloads.availableOnDevice')
        : transfer?.localState === 'corrupt'
          ? t('downloads.localFileIncomplete')
          : null;
  const created = formatDownloadDate(item.createdAt);
  const completedAt = formatDownloadDate(item.downloadedAt);
  const sourceHost = formatSourceHost(item.sourceUrl);
  const failedForGood = item.status === 'FAILED' && (item.workerState ?? '').toUpperCase() !== 'RETRY_WAIT';
  const retryWait = item.status === 'FAILED' && (item.workerState ?? '').toUpperCase() === 'RETRY_WAIT';

  return (
    <>
      <DsCard testID="download-details-hero">
        <DsText variant="hero" align="center" importantForAccessibility="no" accessibilityElementsHidden>
          {recordingLine ? formatRecordedTime(transfer?.recordedMs) : heroPercent}
        </DsText>
        <DsText variant="body" color="textPrimary" align="center" numberOfLines={2} style={{ marginTop: 2 }}>
          {heroLine || statusLabel}
        </DsText>
        {!recordingLine ? (
          <DsProgressBar progress={progressFraction} accessibilityLabel={`${statusLabel}, ${heroPercent}`} style={{ marginTop: 14 }} testID="download-details-progress" />
        ) : null}
        {item.status !== 'DOWNLOADING' || waitingLabel ? (
          <DsText variant="rowSub" align="center" style={{ marginTop: 10 }} testID="download-details-status">
            {waitingLabel ?? statusLabel}
          </DsText>
        ) : null}
      </DsCard>

      {failedForGood ? (
        <NoticeCard
          title={t('downloads.failedBanner')}
          body={sanitizeErrorMessage(item.errorMessage)}
          onHelp={() => openSupportWithContext(getDownloadSupportContext(item.errorCode))}
          testID="download-details-failed"
        />
      ) : null}
      {retryWait ? <NoticeCard title={t('downloads.retryingSoon')} body={t('downloads.retryingSoonBody')} testID="download-details-retrying" /> : null}
      {completed && !canUseLocalFile ? (
        <NoticeCard
          title={t('downloads.fileUnavailableTitle')}
          body={t('downloads.detailsFileUnavailable')}
          onHelp={() => openSupportWithContext(FILE_UNAVAILABLE_SUPPORT_CONTEXT)}
          testID="download-details-unavailable"
        />
      ) : null}
      {actionError ? (
        <DsText variant="body" color="primary" accessibilityLiveRegion="polite">
          {actionError}
        </DsText>
      ) : null}

      {buttons.map((row, index) => (
        <DsButtonRow key={index}>
          {row.map(({ action, primary }) => (
            <DsButton
              key={action}
              label={action === 'play' ? t('files.play') : action === 'cancel' && !primary ? t('downloads.secondaryCancel') : t(PRIMARY_LABEL_KEYS[action])}
              variant={primary ? 'primary' : 'secondary'}
              onPress={action === 'play' ? onPlay : primary ? onPrimary : () => onSecondary(action)}
              loading={primary && action !== 'play' && mutating}
              disabled={!primary && mutating}
              flex
              accessibilityHint={action === 'play' ? t('library.playHint') : undefined}
              testID={`download-details-${primary ? 'primary' : 'secondary'}-${action}`}
            />
          ))}
        </DsButtonRow>
      ))}

      <DsSectionLabel>{t('lightDetails.segmentsOne')}</DsSectionLabel>
      <DownloadSegmentBars fractions={[recordingLine ? 0 : progressFraction]} />

      <DsRowGroup testID="download-details-rows">
        <DsRow
          icon="gauge"
          title={t('lightDetails.priority')}
          subtitle={live && bandwidth.available ? (bandwidth.priority ? t('lightDetails.priorityHigh') : t('lightDetails.priorityNormal')) : undefined}
          onPress={() => requireUnfinishedBandwidth('priority')}
          testID="download-details-priority"
        />
        <DsRow
          icon="battery-medium"
          title={t('lightDetails.connectionsPerFile')}
          subtitle={String(connectionsPerFile)}
          onPress={() => setSheet('connections')}
          testID="download-details-connections"
        />
        <DsRow
          icon="gauge"
          title={t('lightDetails.perDownloadLimit')}
          subtitle={live && bandwidth.available ? speedLimitText(bandwidth.speedLimit) : undefined}
          onPress={() => requireUnfinishedBandwidth('limit')}
          testID="download-details-limit"
        />
        <DsRow icon="layers" title={t('lightDetails.mirrorSources')} subtitle={t('lightStatistics.none')} onPress={notYet} testID="download-details-mirrors" />
        <DsRow
          icon="layers"
          title={t('lightDetails.checksumRepair')}
          onPress={() => (integrityAvailable ? togglePanel('integrity') : notYet())}
          testID="download-details-integrity-row"
        />
        <DsRow icon="file-text" title={t('lightDetails.notesTagsLock')} onPress={() => requireCompleted('organize')} testID="download-details-organize-row" />
        <DsRow
          icon="clock"
          title={t('lightDetails.startAt')}
          subtitle={live && !recordingLine ? startAtLabel : undefined}
          onPress={() => {
            if (!live || recordingLine) {
              ToastAndroid.show(t('lightDetails.unfinishedOnly'), ToastAndroid.SHORT);
            } else if (!startAtAvailable) {
              notYet();
            } else {
              togglePanel('startAt');
            }
          }}
          testID="download-details-start-at-row"
        />
        <DsRow
          icon="folder"
          title={t('lightDetails.saveLocation')}
          subtitle={copyTarget ? copyTarget.folderLabel ?? copyTarget.name : completed ? folderLabel : undefined}
          onPress={() => (completed ? onOpenFolderPicker() : ToastAndroid.show(t('lightDetails.finishedOnly'), ToastAndroid.SHORT))}
          accessibilityHint={completed ? t('downloads.moveToFolderHint') : undefined}
          testID="download-details-save-location-row"
        />
        <DsRow icon="image" title={t('lightDetails.saveThumbnail')} onPress={onSaveThumbnail} disabled={savingThumbnail} testID="download-details-save-thumbnail" />
        <DsRow icon="languages" title={t('lightDetails.subtitles')} onPress={() => requireCompleted('subtitles')} testID="download-details-subtitles-row" />
        <DsRow icon="link" title={t('lightDetails.linkActions')} onPress={openLinks} testID="download-details-links-row" />
        <DsRow icon="scissors" title={t('lightDetails.edit')} onPress={() => requireCompleted('edit', editAvailable)} testID="download-details-edit-row" />
        <DsRow
          icon="pencil"
          title={t('lightDetails.rename')}
          onPress={() => (canUseLocalFile ? onRename() : ToastAndroid.show(t('lightDetails.finishedOnly'), ToastAndroid.SHORT))}
          testID="download-details-rename-row"
        />
        <DsRow
          icon="heart"
          title={t('lightDetails.favorite')}
          toggle={{ value: isFavorited, onValueChange: onFavorite, accessibilityLabel: t('lightDetails.favorite') }}
          disabled={favoritePending || !item.sourceUrl}
          testID="download-details-favorite"
        />
        <DsRow icon="info" title={t('lightDetails.info')} onPress={() => togglePanel('info')} testID="download-details-info-row" />
      </DsRowGroup>

      {panel === 'integrity' ? (
        <DsCard testID="download-details-integrity-panel">
          <DownloadIntegritySection id={item.id} status={item.status} workerState={item.workerState} />
        </DsCard>
      ) : null}
      {panel === 'organize' ? (
        <DsCard testID="download-details-organize-panel">
          <DownloadTagsAndNote id={item.id} />
          <DownloadMoveToPrivateAction id={item.id} />
        </DsCard>
      ) : null}
      {panel === 'startAt' ? (
        <DsCard testID="download-details-start-at-panel">
          <DownloadStartAtControl downloadId={item.id} startAt={transfer?.startAt ?? null} />
          <DownloadBandwidthControls downloadId={item.id} />
        </DsCard>
      ) : null}
      {panel === 'subtitles' ? (
        <DsCard testID="download-details-subtitles-panel">
          <DownloadSubtitlesSection id={item.id} />
        </DsCard>
      ) : null}
      {panel === 'edit' ? (
        <DsCard testID="download-details-edit-panel">
          <DownloadEditActions id={item.id} />
        </DsCard>
      ) : null}
      <DownloadSaveLocationAction id={item.id} />
      {panel === 'info' ? (
        <DsCard testID="download-details-info-panel">
          <DsText variant="cardTitle">{t('downloads.detailsInfoTitle')}</DsText>
          {mediaType ? <InfoRow label={t('downloads.infoFormat')} value={mediaType} /> : null}
          {platform ? <InfoRow label={t('downloads.infoPlatform')} value={platform} /> : null}
          {durationLabel ? <InfoRow label={t('downloads.infoDuration')} value={durationLabel} /> : null}
          {qualityLabel ? <InfoRow label={t('downloads.infoQuality')} value={qualityLabel} /> : null}
          {resolutionLabel ? <InfoRow label={t('downloads.infoResolution')} value={resolutionLabel} /> : null}
          {bitrateLabel ? <InfoRow label={t('downloads.infoBitrate')} value={bitrateLabel} /> : null}
          {totalSize ? <InfoRow label={t('downloads.infoFileSize')} value={totalSize} /> : null}
          {retryLabel ? <InfoRow label={t('downloads.infoRetryAttempts')} value={retryLabel} /> : null}
          {localAvailability ? <InfoRow label={t('downloads.infoLocalFile')} value={localAvailability} /> : null}
          {completed ? <InfoRow label={t('downloads.infoFolder')} value={folderLabel} /> : null}
          {downloadedSize && live ? <InfoRow label={t('downloads.infoDownloaded')} value={downloadedSize} /> : null}
          <DownloadProgressDetailsRows id={item.id} />
          {created ? <InfoRow label={t('downloads.infoCreatedDate')} value={created} /> : null}
          {completedAt ? <InfoRow label={t('downloads.infoDownloadedDate')} value={completedAt} /> : null}
          {sourceHost || item.sourceUrl ? (
            <View style={{ marginTop: 12, gap: 4 }}>
              <DsText variant="rowSub">{t('downloads.detailsSourceTitle')}</DsText>
              {sourceHost ? (
                <DsText variant="bodyStrong" numberOfLines={1}>
                  {sourceHost}
                </DsText>
              ) : null}
              <DsText variant="rowSub" numberOfLines={2}>
                {item.sourceUrl}
              </DsText>
            </View>
          ) : null}
        </DsCard>
      ) : null}

      <ChoiceSheet
        visible={sheet === 'priority'}
        title={t('lightDetails.priority')}
        options={priorityOptions}
        value={bandwidth.priority ? 'high' : 'normal'}
        onSelect={(value) => void bandwidth.setPriority(value === 'high')}
        onClose={closeSheet}
        testID="download-details-priority-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'connections'}
        title={t('lightDetails.connectionsPerFile')}
        options={connectionOptions}
        value={String(connectionsPerFile)}
        onSelect={(value) => useSettingsStore.getState().updateSetting('connectionsPerFile', Number(value))}
        onClose={closeSheet}
        testID="download-details-connections-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'limit'}
        title={t('lightDetails.perDownloadLimit')}
        options={limitOptions}
        value={String(normalizeSpeedLimit(bandwidth.speedLimit))}
        onSelect={(value) => void bandwidth.setSpeedLimit(Number(value))}
        onClose={closeSheet}
        testID="download-details-limit-sheet"
      />
      <ActionSheetModal
        visible={sheet === 'links'}
        onClose={closeSheet}
        title={t('lightDetails.linkActions')}
        subtitle={shareUrl ?? undefined}
        actions={linkActions}
        testID="download-details-links-sheet"
      />
    </>
  );
});

export const DownloadDetailsScreen = memo(function DownloadDetailsScreen() {
  const { t } = useTranslation();
  const {
    downloadId,
    item,
    status,
    loadError,
    actionError,
    mutating,
    primaryAction,
    secondaryActions,
    deleteVisible,
    deleting,
    isFavorited,
    favoritePending,
    favoriteError,
    canUseLocalFile,
    goBack,
    runAction,
    confirmDelete,
    cancelDelete,
    onFavoritePress,
    dismissFavoriteError,
    retryLoad,
  } = useDownloadDetailsScreen();

  const foldersById = useFoldersStore((s) => s.itemsById);
  const folderOrderedIds = useFoldersStore((s) => s.orderedIds);
  const ensureFoldersReady = useFoldersStore((s) => s.ensureReady);
  const createFolder = useFoldersStore((s) => s.createFolder);
  const renameFolder = useFoldersStore((s) => s.renameFolder);
  const deleteFolder = useFoldersStore((s) => s.deleteFolder);

  const moveMediaToFolder = useMediaFolderAssignmentsStore((s) => s.moveMediaToFolder);
  const getEffectiveFolderId = useMediaFolderAssignmentsStore((s) => s.getEffectiveFolderId);
  const pendingByMediaId = useMediaFolderAssignmentsStore((s) => s.pendingByMediaId);

  const [folderPickerVisible, setFolderPickerVisible] = useState(false);
  const [manageFoldersVisible, setManageFoldersVisible] = useState(false);

  const [createDraft, setCreateDraft] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [renameFileVisible, setRenameFileVisible] = useState(false);
  const [renameFileDraft, setRenameFileDraft] = useState('');
  const [renameFileBusy, setRenameFileBusy] = useState(false);
  const [renameFileError, setRenameFileError] = useState<string | null>(null);

  useEffect(() => {
    if (!item || item.status !== 'COMPLETED') return;
    void ensureFoldersReady();
  }, [ensureFoldersReady, item]);

  const folderPending = item ? Boolean(pendingByMediaId[item.id]) : false;
  const effectiveFolderId = item ? getEffectiveFolderId(item.id, item.folderId) : null;
  const folderLabel = effectiveFolderId === null ? 'Downloads / Unfiled' : (foldersById[effectiveFolderId]?.name ?? 'Unfiled');

  const handleOpenFolderPicker = useCallback(() => {
    if (!item || item.status !== 'COMPLETED') return;
    setFolderPickerVisible(true);
  }, [item]);

  const folderPickerActions = useMemo<ActionSheetItem[]>(
    () => [
      {
        id: UNFILED_FOLDER_SELECTION_ID,
        label: effectiveFolderId === null ? 'Unfiled / Downloads ✓' : 'Unfiled / Downloads',
        onPress: () => {
          if (!item || folderPending) return;
          void moveMediaToFolder({ mediaId: item.id, desiredFolderId: null, fallbackFolderId: item.folderId }).catch(() => undefined);
        },
      },
      ...folderOrderedIds
        .map<ActionSheetItem | null>((id) => {
          const folder = foldersById[id];
          if (!folder) return null;
          const selected = effectiveFolderId === id;
          return {
            id,
            label: selected ? `${folder.name} ✓` : folder.name,
            onPress: () => {
              if (!item || folderPending) return;
              void moveMediaToFolder({ mediaId: item.id, desiredFolderId: id, fallbackFolderId: item.folderId }).catch(() => undefined);
            },
          };
        })
        .filter((x): x is ActionSheetItem => x != null),
      {
        id: 'manage',
        label: t('downloads.manageFolders'),
        onPress: () => {
          setFolderPickerVisible(false);
          setManageFoldersVisible(true);
        },
      },
    ],
    [effectiveFolderId, folderPending, folderOrderedIds, foldersById, item, moveMediaToFolder, t],
  );

  const startRenameFolder = useCallback(
    (id: string) => {
      setRenameTargetId(id);
      setRenameDraft(foldersById[id]?.name ?? '');
      setRenameError(null);
    },
    [foldersById],
  );

  const cancelRenameFolder = useCallback(() => {
    setRenameTargetId(null);
    setRenameDraft('');
    setRenameError(null);
  }, []);

  const createFolderNow = useCallback(async () => {
    if (!createDraft.trim()) {
      setCreateError(t('files.emptyFolderName'));
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createFolder(createDraft);
      setCreateDraft('');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t('errors.unexpected'));
    } finally {
      setCreateBusy(false);
    }
  }, [createDraft, createFolder, t]);

  const confirmRenameFolder = useCallback(async () => {
    if (!renameTargetId) return;
    if (!renameDraft.trim()) {
      setRenameError(t('files.emptyFolderName'));
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      await renameFolder(renameTargetId, renameDraft);
      cancelRenameFolder();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : t('errors.unexpected'));
    } finally {
      setRenameBusy(false);
    }
  }, [cancelRenameFolder, renameDraft, renameFolder, renameTargetId, t]);

  const requestDeleteFolder = useCallback((id: string) => {
    setDeleteTargetId(id);
    setDeleteError(null);
  }, []);

  const cancelDeleteFolder = useCallback(() => {
    setDeleteTargetId(null);
    setDeleteBusy(false);
    setDeleteError(null);
  }, []);

  const confirmDeleteFolder = useCallback(async () => {
    if (!deleteTargetId) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteFolder(deleteTargetId);
      setDeleteTargetId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t('errors.unexpected'));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteFolder, deleteTargetId, t]);

  const startRenameFile = useCallback(() => {
    if (!downloadId || !item) return;
    setRenameFileError(null);
    // A v2 library item is renamed by its title (its private file keeps a stable name).
    const engineOwned = isEngineOwned(useDownloadsStore.getState(), downloadId);
    setRenameFileDraft(engineOwned ? item.title?.trim() || '' : item.fileName?.trim() || item.title?.trim() || '');
    setRenameFileVisible(true);
  }, [downloadId, item]);

  const cancelRenameFile = useCallback(() => {
    setRenameFileVisible(false);
    setRenameFileBusy(false);
    setRenameFileError(null);
    setRenameFileDraft('');
  }, []);

  const confirmRenameFile = useCallback(async () => {
    if (!downloadId || !item) return;
    if (!renameFileDraft.trim()) {
      setRenameFileError(t('files.emptyName'));
      return;
    }
    setRenameFileBusy(true);
    setRenameFileError(null);
    try {
      const nextName = renameFileDraft.trim();
      if (isEngineOwned(useDownloadsStore.getState(), downloadId)) {
        // The engine's library item: its change event updates this screen, Downloads and Player alike.
        await renameEngineLibraryItem(getV2Engine(), downloadId, nextName);
      } else {
        await renameMediaFileOnDevice(downloadId, nextName);
        useDownloadsStore.getState().patchItem(downloadId, { fileName: nextName, title: nextName });
      }
      setRenameFileVisible(false);
      setRenameFileDraft('');
      void retryLoad();
    } catch (error) {
      setRenameFileError(error instanceof Error ? error.message : t('files.unavailable'));
    } finally {
      setRenameFileBusy(false);
    }
  }, [downloadId, item, renameFileDraft, retryLoad, t]);

  const handlePrimary = useCallback(() => {
    if (primaryAction) void runAction(primaryAction);
  }, [primaryAction, runAction]);
  const handlePlay = useCallback(() => {
    if (downloadId) openPlayer(downloadId);
  }, [downloadId]);
  const handleSecondary = useCallback((action: DownloadCardAction) => void runAction(action), [runAction]);
  const handleConfirmDelete = useCallback(() => void confirmDelete(), [confirmDelete]);
  const handleRetry = useCallback(() => void retryLoad(), [retryLoad]);
  const handleFavoritePress = useCallback(() => void onFavoritePress(), [onFavoritePress]);
  const openSettings = useCallback(() => navigation.push(routePaths.downloadSettings), []);

  const title = item ? item.title?.trim() || item.fileName?.trim() || t('downloads.untitled') : '';
  const quality = item && typeof item.quality === 'string' && item.quality.trim() ? item.quality.trim() : null;
  const subtitle = item ? (quality ? t('lightDetails.subtitle', { title, quality }) : title) : undefined;

  return (
    <DsScreen testID="download-details-screen">
      <DsHeader
        title={t('lightDetails.title')}
        subtitle={subtitle}
        onBack={goBack}
        action={{ icon: 'settings', accessibilityLabel: t('lightDetails.settingsA11y'), onPress: openSettings }}
        testID="download-details-header"
      />

      {status === 'loading' ? <DownloadDetailsSkeleton /> : null}

      {status === 'error' ? (
        <DsCard testID="download-details-error">
          <DsText variant="cardTitle">{t('downloads.detailsErrorTitle')}</DsText>
          <DsText variant="body" style={{ marginTop: 4 }}>
            {loadError || t('lightDetails.loadFailed')}
          </DsText>
          <DsButton label={t('common.retry')} variant="secondary" onPress={handleRetry} fullWidth style={{ marginTop: 12 }} />
        </DsCard>
      ) : null}

      {status === 'missing' ? (
        <DsCard testID="download-details-missing">
          <DsText variant="cardTitle">{t('downloads.detailsMissingTitle')}</DsText>
          <DsText variant="body" style={{ marginTop: 4 }}>
            {t('downloads.detailsMissingDescription')}
          </DsText>
          <DsButton label={t('downloads.detailsMissingAction')} onPress={goBack} fullWidth style={{ marginTop: 12 }} />
        </DsCard>
      ) : null}

      {status === 'ready' && item ? (
        <DetailsBody
          item={item}
          mutating={mutating}
          actionError={actionError}
          primaryAction={primaryAction}
          secondaryActions={secondaryActions}
          canUseLocalFile={canUseLocalFile}
          isFavorited={isFavorited}
          favoritePending={favoritePending}
          folderLabel={folderLabel}
          onOpenFolderPicker={handleOpenFolderPicker}
          onRename={startRenameFile}
          onFavorite={handleFavoritePress}
          onPlay={handlePlay}
          onPrimary={handlePrimary}
          onSecondary={handleSecondary}
        />
      ) : null}

      <DownloadDeleteDialog
        visible={deleteVisible}
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={cancelDelete}
        testID="download-details-delete-dialog"
      />

      <ConfirmModal
        visible={Boolean(favoriteError)}
        variant="error"
        title={t('downloads.detailsFavoriteErrorTitle')}
        message={favoriteError ?? ''}
        confirmLabel={t('common.ok')}
        cancelLabel={t('common.close')}
        onConfirm={dismissFavoriteError}
        onCancel={dismissFavoriteError}
        testID="download-details-favorite-error"
      />

      <AppModal visible={renameFileVisible} onClose={cancelRenameFile} title={t('files.renameFile')} subtitle={t('downloads.renameDisplayName')} showCloseButton>
        <Box gap={16}>
          <Box gap={8}>
            <Text variant="label" color="textSecondary">
              {t('downloads.newName')}
            </Text>
            <TextField
              label={t('downloads.newName')}
              value={renameFileDraft}
              onChangeText={(v) => {
                setRenameFileDraft(v);
                setRenameFileError(null);
              }}
              error={renameFileError ?? undefined}
              disabled={renameFileBusy}
            />
          </Box>
          <Box row gap={12}>
            <Box flex={1}>
              <Button
                title={t('common.save')}
                onPress={() => void confirmRenameFile()}
                loading={renameFileBusy}
                disabled={renameFileBusy || !renameFileDraft.trim()}
                fullWidth
              />
            </Box>
            <Box flex={1}>
              <Button title={t('common.cancel')} variant="outline" onPress={cancelRenameFile} disabled={renameFileBusy} fullWidth />
            </Box>
          </Box>
        </Box>
      </AppModal>

      <ActionSheetModal
        visible={folderPickerVisible}
        onClose={() => setFolderPickerVisible(false)}
        title={t('downloads.moveToFolder')}
        subtitle={t('downloads.moveToFolderSubtitle')}
        actions={folderPickerActions}
        testID="download-details-folder-picker"
      />

      <AppModal
        visible={manageFoldersVisible}
        onClose={() => setManageFoldersVisible(false)}
        title={t('downloads.manageFolders')}
        subtitle={t('downloads.manageFoldersSubtitle')}
        showCloseButton>
        <Box gap={16}>
          <Box gap={8}>
            <Text variant="label" color="textSecondary">
              {t('downloads.newFolder')}
            </Text>
            <TextField
              label={t('downloads.folderName')}
              value={createDraft}
              onChangeText={(v) => {
                setCreateDraft(v);
                setCreateError(null);
              }}
              error={createError ?? undefined}
              disabled={createBusy || renameBusy}
            />
            <Button
              title={t('common.create')}
              onPress={() => void createFolderNow()}
              loading={createBusy}
              disabled={!createDraft.trim() || createBusy || renameBusy}
            />
          </Box>

          {renameTargetId ? (
            <Box gap={8}>
              <Text variant="label" color="textSecondary">
                {t('files.renameFolder')}
              </Text>
              <TextField
                label={t('downloads.newName')}
                value={renameDraft}
                onChangeText={(v) => {
                  setRenameDraft(v);
                  setRenameError(null);
                }}
                error={renameError ?? undefined}
                disabled={renameBusy}
              />
              <Box row gap={12}>
                <Box flex={1}>
                  <Button title={t('common.save')} onPress={() => void confirmRenameFolder()} loading={renameBusy} disabled={renameBusy} fullWidth />
                </Box>
                <Box flex={1}>
                  <Button title={t('common.cancel')} variant="outline" onPress={cancelRenameFolder} disabled={renameBusy} fullWidth />
                </Box>
              </Box>
            </Box>
          ) : null}

          <Box gap={8}>
            <Text variant="label" color="textSecondary">
              {t('downloads.yourFolders')}
            </Text>
            {folderOrderedIds.length === 0 ? (
              <Text variant="bodySmall" color="textSecondary">
                {t('downloads.noFoldersYet')}
              </Text>
            ) : (
              <Box gap={8}>
                {folderOrderedIds.map((id) => {
                  const folder = foldersById[id];
                  if (!folder) return null;
                  return (
                    <Box key={id} row center style={{ justifyContent: 'space-between', gap: 12 }}>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text variant="bodySmall" color="textPrimary" numberOfLines={1}>
                          {folder.name}
                        </Text>
                      </Box>
                      <Box row gap={8}>
                        <Button title={t('files.rename')} variant="outline" size="small" onPress={() => startRenameFolder(id)} disabled={renameBusy || createBusy} />
                        <Button title={t('common.delete')} variant="destructive" size="small" onPress={() => requestDeleteFolder(id)} disabled={renameBusy || createBusy} />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
            {deleteError ? (
              <Text variant="caption" color="error">
                {deleteError}
              </Text>
            ) : null}
          </Box>
        </Box>
      </AppModal>

      <ConfirmModal
        visible={Boolean(deleteTargetId)}
        variant="delete"
        title={t('downloads.deleteFolder')}
        message={t('downloads.deleteFolderMessage')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={deleteBusy}
        onConfirm={() => void confirmDeleteFolder()}
        onCancel={cancelDeleteFolder}
        testID="download-details-delete-folder-dialog"
      />
    </DsScreen>
  );
});
