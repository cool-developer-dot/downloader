import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { Button } from '@/components/buttons/Button';
import { IconButton } from '@/components/buttons/IconButton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { ProgressBar } from '@/components/common/ProgressBar';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { AppModal } from '@/components/modals/AppModal';
import { TextField } from '@/components/inputs/TextField';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, playerPath } from '@/navigation';
import {
  FILE_UNAVAILABLE_SUPPORT_CONTEXT,
  getDownloadSupportContext,
} from '@/support';
import { openSupportWithContext } from '@/support/support-navigation';
import type { DownloadItem } from '@/store/downloads';
import { useDownloadsStore } from '@/store/downloads';
import { UNFILED_FOLDER_SELECTION_ID } from '@/library/constants';
import { useFoldersStore } from '@/store/organization/folders';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';
import { renameMediaFileOnDevice } from '@/downloads/engine';

import { DownloadDeleteDialog } from './components/DownloadDeleteDialog';
import { DownloadDetailsSkeleton } from './components/DownloadDetailsSkeleton';
import { useDownloadDetailsScreen } from './hooks/useDownloadDetailsScreen';
import { useDownloadsTokens } from './theme/downloads-tokens';
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
  sanitizeErrorMessage,
  type DownloadCardAction,
} from './utils/download-format';
import { formatDuration } from '@/media-detection/utils';

const PRIMARY_LABEL_KEYS: Record<
  DownloadCardAction,
  | 'downloads.primaryPause'
  | 'downloads.primaryResume'
  | 'downloads.primaryCancel'
  | 'downloads.primaryRetry'
  | 'downloads.primaryOpen'
  | 'downloads.primaryShare'
  | 'downloads.primaryRemove'
> = {
  pause: 'downloads.primaryPause',
  resume: 'downloads.primaryResume',
  cancel: 'downloads.primaryCancel',
  retry: 'downloads.primaryRetry',
  open: 'downloads.primaryOpen',
  share: 'downloads.primaryShare',
  remove: 'downloads.primaryRemove',
};

const PRIMARY_VARIANT: Record<
  DownloadCardAction,
  'primary' | 'destructive' | 'outline'
> = {
  pause: 'primary',
  resume: 'primary',
  cancel: 'destructive',
  retry: 'primary',
  open: 'primary',
  share: 'outline',
  remove: 'destructive',
};

type InfoRowProps = {
  label: string;
  value: string;
  accessibilityLabel?: string;
};

const InfoRow = memo(function InfoRow({
  label,
  value,
  accessibilityLabel,
}: InfoRowProps) {
  const theme = useTheme();

  return (
    <Box
      row
      py={10}
      style={{
        justifyContent: 'space-between',
        gap: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
      }}
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}>
      <Text variant="bodySmall" color="textSecondary">
        {label}
      </Text>
      <Box flex={1} style={{ minWidth: 0 }}>
        <Text
          variant="bodySmall"
          color="textPrimary"
          numberOfLines={2}
          style={{ textAlign: 'right' }}>
          {value}
        </Text>
      </Box>
    </Box>
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
  folderLabel: string;
  folderPending: boolean;
  onOpenFolderPicker: () => void;
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
  folderLabel,
  folderPending,
  onOpenFolderPicker,
  onPrimary,
  onSecondary,
}: DetailsBodyProps) {
  const downloadsTokens = useDownloadsTokens();
  const { t } = useTranslation();
  const [thumbFailed, setThumbFailed] = useState(false);
  const transfer = useDownloadsStore((s) => s.transferById[item.id] ?? null);

  const title = item.title?.trim() || item.fileName?.trim() || t('downloads.untitled');
  const statusLabel = getExecutionStatusLabel({
    status: item.status,
    workerState: item.workerState,
    downloadId: item.id,
  });
  const statusColors = downloadsTokens.status[item.status];
  const mediaType = extractMediaType(item.fileName);
  const platform = formatPlatform(item.platform);
  const progressPercent =
    transfer?.progress != null ? transfer.progress : item.progress;
  const knownTotalBytes =
    transfer?.totalBytes != null && transfer.totalBytes > 0
      ? transfer.totalBytes
      : Number(item.fileSize) > 0
        ? Number(item.fileSize)
        : null;
  const totalSize =
    knownTotalBytes != null
      ? formatDownloadFileSize(String(knownTotalBytes))
      : null;
  const qualityLabel =
    typeof item.quality === 'string' && item.quality.trim()
      ? item.quality.trim()
      : null;
  const resolutionLabel = formatDurableResolution(item.resolution);
  const bitrateLabel = formatDurableBitrate(item.bitrate);
  const durationLabel = formatDuration(
    typeof (item as any).duration === 'number' &&
      Number.isFinite((item as any).duration)
      ? (item as any).duration
      : null,
  );
  const retryLabel =
    typeof item.retryCount === 'number' && item.retryCount > 0
      ? String(item.retryCount)
      : null;
  const downloadedSize =
    transfer?.bytesWritten != null && transfer.bytesWritten > 0
      ? formatDownloadFileSize(String(transfer.bytesWritten))
      : knownTotalBytes != null
        ? formatDownloadedBytes(item.fileSize, item.progress)
        : null;
  const speedLabel =
    item.status === 'DOWNLOADING' || item.status === 'PAUSED'
      ? formatTransferSpeed(transfer?.bytesPerSecond ?? null)
      : null;
  const etaLabel =
    item.status === 'DOWNLOADING' || item.status === 'PAUSED'
      ? formatEtaSeconds(transfer?.etaSeconds ?? null)
      : null;
  const localAvailability =
    transfer?.localState === 'missing'
      ? t('downloads.missingOnDevice')
      : transfer?.localState === 'complete'
        ? t('downloads.availableOnDevice')
        : transfer?.localState === 'corrupt'
          ? t('downloads.localFileIncomplete')
          : null;
  const created = formatDownloadDate(item.createdAt);
  const completed = formatDownloadDate(item.downloadedAt);
  const sourceHost = formatSourceHost(item.sourceUrl);
  const showProgress =
    item.status === 'DOWNLOADING' ||
    item.status === 'PAUSED' ||
    item.status === 'QUEUED' ||
    item.status === 'COMPLETED';

  return (
    <ScrollView
      testID="download-details-scroll"
      contentContainerStyle={{
        paddingHorizontal: downloadsTokens.spacing.screenX,
        paddingBottom: 32,
        gap: 16,
      }}
      keyboardShouldPersistTaps="handled">
      <Box
        style={{
          width: '100%',
          height: downloadsTokens.heroHeight,
          borderRadius: downloadsTokens.radius.card,
          backgroundColor: downloadsTokens.thumbnailBg,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        accessibilityLabel={t('downloads.thumbnailA11y', { title })}
        accessibilityIgnoresInvertColors>
        {item.thumbnailUrl && !thumbFailed ? (
          <Image
            source={{ uri: item.thumbnailUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            onError={() => setThumbFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Icon name="video-outline" size="xl" color="secondary" />
        )}
      </Box>

      <Box gap={6}>
        <Text
          variant="title"
          color="textPrimary"
          accessibilityRole="header"
          accessibilityLabel={title}>
          {title}
        </Text>
        {item.fileName ? (
          <Text variant="bodySmall" color="textSecondary" numberOfLines={2}>
            {item.fileName}
          </Text>
        ) : null}
      </Box>

      <Box
        px={12}
        py={6}
        style={{
          alignSelf: 'flex-start',
          borderRadius: downloadsTokens.radius.badge,
          backgroundColor: statusColors.bg,
        }}
        accessibilityRole="text"
        accessibilityLabel={t('downloads.statusA11y', { label: statusLabel })}>
        <Text
          variant="caption"
          style={{
            color: statusColors.fg,
            fontWeight: '700',
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}>
          {statusLabel}
        </Text>
      </Box>

      {showProgress ? (
        <Box gap={10}>
          <Text
            variant="display"
            color="textPrimary"
            style={{ fontSize: 40, lineHeight: 48, fontWeight: '700' }}
            importantForAccessibility="no"
            accessibilityElementsHidden>
            {knownTotalBytes == null &&
            item.status !== 'COMPLETED' &&
            progressPercent <= 0
              ? '—'
              : `${Math.round(progressPercent)}%`}
          </Text>
          <ProgressBar
            progress={Math.min(1, Math.max(0, progressPercent / 100))}
            testID="download-details-progress"
          />
          {downloadedSize && totalSize ? (
            <Text variant="bodySmall" color="textSecondary">
              {`${downloadedSize} / ${totalSize}`}
            </Text>
          ) : downloadedSize ? (
            <Text variant="bodySmall" color="textSecondary">
              {t('downloads.downloadedProgress', { size: downloadedSize })}
            </Text>
          ) : totalSize ? (
            <Text variant="bodySmall" color="textSecondary">
              {totalSize}
            </Text>
          ) : null}
          {speedLabel || etaLabel ? (
            <Text variant="bodySmall" color="textSecondary">
              {[speedLabel, etaLabel].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {item.status === 'FAILED' &&
      (item.workerState ?? '').toUpperCase() !== 'RETRY_WAIT' ? (
        <Box
          gap={8}
          p={14}
          style={{
            borderRadius: downloadsTokens.radius.card,
            backgroundColor: downloadsTokens.status.FAILED.bg,
          }}
          accessibilityLabel={`${t('downloads.failedBanner')}. ${sanitizeErrorMessage(item.errorMessage)}`}>
          <Text variant="body" style={{ color: downloadsTokens.status.FAILED.fg }}>
            {t('downloads.failedBanner')}
          </Text>
          <Text variant="bodySmall" color="textSecondary">
            {sanitizeErrorMessage(item.errorMessage)}
          </Text>
          <Button
            title={t('support.getHelp')}
            variant="outline"
            onPress={() => {
              openSupportWithContext(getDownloadSupportContext(item.errorCode));
            }}
            accessibilityLabel={t('support.getHelpA11y')}
            accessibilityHint={t('support.getHelpHint')}
          />
        </Box>
      ) : null}

      {item.status === 'FAILED' &&
      (item.workerState ?? '').toUpperCase() === 'RETRY_WAIT' ? (
        <Box
          gap={8}
          p={14}
          style={{
            borderRadius: downloadsTokens.radius.card,
            backgroundColor: downloadsTokens.status.QUEUED.bg,
          }}
          accessibilityLabel={t('downloads.retryingSoonA11y')}>
          <Text variant="body" color="textPrimary">
            {t('downloads.retryingSoon')}
          </Text>
          <Text variant="bodySmall" color="textSecondary">
            {t('downloads.retryingSoonBody')}
          </Text>
        </Box>
      ) : null}

      {item.status === 'COMPLETED' && !canUseLocalFile ? (
        <Box
          gap={8}
          p={14}
          style={{
            borderRadius: downloadsTokens.radius.card,
            backgroundColor: downloadsTokens.status.FAILED.bg,
          }}
          accessibilityLabel={t('downloads.detailsFileUnavailable')}>
          <Text variant="body" style={{ color: downloadsTokens.status.FAILED.fg }}>
            {t('downloads.fileUnavailableTitle')}
          </Text>
          <Text variant="bodySmall" color="textSecondary">
            {t('downloads.detailsFileUnavailable')}
          </Text>
          <Button
            title={t('support.getHelp')}
            variant="outline"
            onPress={() => {
              openSupportWithContext(FILE_UNAVAILABLE_SUPPORT_CONTEXT);
            }}
            accessibilityLabel={t('support.getHelpA11y')}
            accessibilityHint={t('support.getHelpHint')}
          />
        </Box>
      ) : null}

      {actionError ? (
        <Text variant="caption" color="error" accessibilityLiveRegion="polite">
          {actionError}
        </Text>
      ) : null}

      {primaryAction ? (
        <Button
          title={t(PRIMARY_LABEL_KEYS[primaryAction])}
          variant={PRIMARY_VARIANT[primaryAction]}
          onPress={onPrimary}
          loading={mutating}
          fullWidth
          accessibilityHint={t(PRIMARY_LABEL_KEYS[primaryAction])}
          testID={`download-details-primary-${primaryAction}`}
        />
      ) : null}

      {secondaryActions.length > 0 ? (
        <Box row gap={10} style={{ flexWrap: 'wrap' }}>
          {secondaryActions.map((action) => (
            <Box key={action} flex={1} style={{ minWidth: 120 }}>
              <Button
                title={
                  action === 'cancel'
                    ? t('downloads.secondaryCancel')
                    : t(PRIMARY_LABEL_KEYS[action])
                }
                variant="outline"
                onPress={() => onSecondary(action)}
                disabled={mutating}
                fullWidth
                testID={`download-details-secondary-${action}`}
              />
            </Box>
          ))}
        </Box>
      ) : null}

      <Box mt={8} gap={4}>
        <Text variant="label" color="textSecondary" style={{ letterSpacing: 0.5 }}>
          {t('downloads.detailsInfoTitle')}
        </Text>
        {mediaType ? <InfoRow label={t('downloads.infoFormat')} value={mediaType} /> : null}
        {platform ? <InfoRow label={t('downloads.infoPlatform')} value={platform} /> : null}
        {durationLabel ? <InfoRow label={t('downloads.infoDuration')} value={durationLabel} /> : null}
        {qualityLabel ? <InfoRow label={t('downloads.infoQuality')} value={qualityLabel} /> : null}
        {resolutionLabel ? (
          <InfoRow label={t('downloads.infoResolution')} value={resolutionLabel} />
        ) : null}
        {bitrateLabel ? <InfoRow label={t('downloads.infoBitrate')} value={bitrateLabel} /> : null}
        {totalSize ? <InfoRow label={t('downloads.infoFileSize')} value={totalSize} /> : null}
        <InfoRow
          label={t('downloads.detailsFavoriteLabel')}
          value={isFavorited ? t('common.yes') : t('common.no')}
          accessibilityLabel={
            isFavorited ? t('downloads.favoriteEnabled') : t('downloads.favoriteDisabled')
          }
        />
        {retryLabel ? (
          <InfoRow label={t('downloads.infoRetryAttempts')} value={retryLabel} />
        ) : null}
        {localAvailability ? (
          <InfoRow label={t('downloads.infoLocalFile')} value={localAvailability} />
        ) : null}
        {item.status === 'COMPLETED' ? (
          <Pressable
            onPress={onOpenFolderPicker}
            disabled={folderPending}
            accessibilityRole="button"
            accessibilityLabel={t('downloads.moveToFolder')}
            accessibilityHint={t('downloads.moveToFolderHint')}>
            <InfoRow label={t('downloads.infoFolder')} value={folderLabel} />
          </Pressable>
        ) : null}
        {downloadedSize &&
        (item.status === 'DOWNLOADING' ||
          item.status === 'PAUSED' ||
          item.status === 'QUEUED') ? (
          <InfoRow label={t('downloads.infoDownloaded')} value={downloadedSize} />
        ) : null}
        {created ? <InfoRow label={t('downloads.infoCreatedDate')} value={created} /> : null}
        {completed ? <InfoRow label={t('downloads.infoDownloadedDate')} value={completed} /> : null}
      </Box>

      {(sourceHost || item.sourceUrl) && (
        <Box mt={8} gap={8}>
          <Text
            variant="label"
            color="textSecondary"
            style={{ letterSpacing: 0.5 }}>
            {t('downloads.detailsSourceTitle')}
          </Text>
          {sourceHost ? (
            <Text variant="body" numberOfLines={1}>
              {sourceHost}
            </Text>
          ) : null}
          <Text
            variant="caption"
            color="textSecondary"
            numberOfLines={2}
            accessibilityLabel={
              sourceHost
                ? `Source host ${sourceHost}`
                : 'Source link available'
            }>
            {item.sourceUrl}
          </Text>
        </Box>
      )}
    </ScrollView>
  );
});

export const DownloadDetailsScreen = memo(function DownloadDetailsScreen() {
  const downloadsTokens = useDownloadsTokens();
  const theme = useTheme();
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

  const moveMediaToFolder = useMediaFolderAssignmentsStore(
    (s) => s.moveMediaToFolder,
  );
  const getEffectiveFolderId = useMediaFolderAssignmentsStore(
    (s) => s.getEffectiveFolderId,
  );
  const pendingByMediaId = useMediaFolderAssignmentsStore(
    (s) => s.pendingByMediaId,
  );

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

  const [fileActionsVisible, setFileActionsVisible] = useState(false);

  const [renameFileVisible, setRenameFileVisible] = useState(false);
  const [renameFileDraft, setRenameFileDraft] = useState('');
  const [renameFileBusy, setRenameFileBusy] = useState(false);
  const [renameFileError, setRenameFileError] = useState<string | null>(null);

  useEffect(() => {
    if (!item || item.status !== 'COMPLETED') return;
    void ensureFoldersReady();
  }, [ensureFoldersReady, item]);

  const folderPending = item ? Boolean(pendingByMediaId[item.id]) : false;

  const effectiveFolderId = item
    ? getEffectiveFolderId(item.id, item.folderId)
    : null;

  const folderLabel =
    effectiveFolderId === null
      ? 'Downloads / Unfiled'
      : foldersById[effectiveFolderId]?.name ?? 'Unfiled';

  const handleOpenFolderPicker = useCallback(() => {
    if (!item || item.status !== 'COMPLETED') return;
    setFolderPickerVisible(true);
  }, [item]);

  const folderPickerActions = useMemo<ActionSheetItem[]>(
    () => [
      {
        id: UNFILED_FOLDER_SELECTION_ID,
        label:
          effectiveFolderId === null
            ? 'Unfiled / Downloads ✓'
            : 'Unfiled / Downloads',
        onPress: () => {
          if (!item) return;
          if (folderPending) return;
          void moveMediaToFolder({
            mediaId: item.id,
            desiredFolderId: null,
            fallbackFolderId: item.folderId,
          }).catch(() => undefined);
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
              if (!item) return;
              if (folderPending) return;
              void moveMediaToFolder({
                mediaId: item.id,
                desiredFolderId: id,
                fallbackFolderId: item.folderId,
              }).catch(() => undefined);
            },
          };
        })
        .filter((x): x is ActionSheetItem => x != null),
      {
        id: 'manage',
        label: 'Manage folders',
        onPress: () => {
          setFolderPickerVisible(false);
          setManageFoldersVisible(true);
        },
      },
    ],
    [
      effectiveFolderId,
      folderPending,
      folderOrderedIds,
      foldersById,
      item,
      moveMediaToFolder,
    ],
  );

  const startRenameFolder = useCallback(
    (id: string) => {
      const folderName = foldersById[id]?.name ?? '';
      setRenameTargetId(id);
      setRenameDraft(folderName);
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
      setCreateError('Folder name cannot be empty.');
      return;
    }

    setCreateBusy(true);
    setCreateError(null);
    try {
      await createFolder(createDraft);
      setCreateDraft('');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Couldn’t create folder.');
    } finally {
      setCreateBusy(false);
    }
  }, [createDraft, createFolder]);

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
      setRenameError(
        error instanceof Error ? error.message : 'Couldn’t rename folder.',
      );
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
      setDeleteError(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Couldn’t delete folder.',
      );
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteFolder, deleteTargetId]);

  const startRenameFile = useCallback(() => {
    if (!downloadId || !item) return;
    setRenameFileError(null);
    setRenameFileDraft(item.fileName?.trim() || item.title?.trim() || '');
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
      await renameMediaFileOnDevice(downloadId, nextName);
      useDownloadsStore.getState().patchItem(downloadId, {
        fileName: nextName,
        title: nextName,
      });

      setRenameFileVisible(false);
      setRenameFileDraft('');
      void retryLoad();
    } catch (error) {
      setRenameFileError(
        error instanceof Error ? error.message : 'Unable to rename this file',
      );
    } finally {
      setRenameFileBusy(false);
    }
  }, [downloadId, item, renameFileDraft, retryLoad, t]);

  const fileActions = useMemo<ActionSheetItem[]>(
    () => {
      if (!item) {
        return [];
      }

      const actions: ActionSheetItem[] = [
        {
          id: 'open',
          label: t('files.open'),
          onPress: () => {
            setFileActionsVisible(false);
            void runAction('open');
          },
        },
        {
          id: 'share',
          label: t('files.share'),
          onPress: () => {
            setFileActionsVisible(false);
            void runAction('share');
          },
        },
        {
          id: 'play',
          label: t('files.play'),
          onPress: () => {
            setFileActionsVisible(false);
            if (!downloadId) return;
            navigation.push(playerPath(downloadId) as any);
          },
        },
        {
          id: 'rename',
          label: t('files.rename'),
          onPress: () => {
            setFileActionsVisible(false);
            startRenameFile();
          },
        },
        {
          id: 'delete',
          label: t('files.delete'),
          onPress: () => {
            setFileActionsVisible(false);
            void runAction('remove');
          },
        },
      ];

      // If local file isn’t usable, keep rename/play hidden.
      if (!canUseLocalFile) {
        return actions.filter((a) => a.id !== 'rename' && a.id !== 'play');
      }

      return actions;
    },
    [
      item,
      canUseLocalFile,
      downloadId,
      navigation,
      runAction,
      startRenameFile,
      t,
    ],
  );

  const openFileActions = useCallback(() => {
    if (!item || item.status !== 'COMPLETED') return;
    setFileActionsVisible(true);
  }, [item]);

  const handlePrimary = useCallback(() => {
    if (!primaryAction) {
      return;
    }
    void runAction(primaryAction);
  }, [primaryAction, runAction]);

  const handleSecondary = useCallback(
    (action: DownloadCardAction) => {
      void runAction(action);
    },
    [runAction],
  );

  const handleConfirmDelete = useCallback(() => {
    void confirmDelete();
  }, [confirmDelete]);

  const handleRetry = useCallback(() => {
    void retryLoad();
  }, [retryLoad]);

  const handleFavoritePress = useCallback(() => {
    void onFavoritePress();
  }, [onFavoritePress]);

  return (
    <SafeAreaScreen
      testID="download-details-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader
        title={t('downloads.detailsTitle')}
        showBack
        onBackPress={goBack}
        actions={
          <Box row gap={8}>
            <IconButton
              icon={isFavorited ? 'heart' : 'heart-outline'}
              accessibilityLabel={
                isFavorited
                  ? t('downloads.detailsFavoriteRemoveLabel')
                  : t('downloads.detailsFavoriteAddLabel')
              }
              accessibilityHint={t('downloads.detailsFavoriteHint')}
              onPress={handleFavoritePress}
              loading={favoritePending}
              variant="ghost"
              color="headerIcon"
              testID="download-details-favorite"
            />
            <IconButton
              icon="menu"
              accessibilityLabel={t('files.actionsTitle')}
              accessibilityHint={t('files.actionsSubtitle')}
              onPress={openFileActions}
              disabled={status !== 'ready' || !item}
              variant="ghost"
              color="headerIcon"
              testID="download-details-file-actions"
            />
          </Box>
        }
        testID="download-details-header"
      />

      {status === 'loading' ? <DownloadDetailsSkeleton /> : null}

      {status === 'error' ? (
        <Box flex={1} center px={downloadsTokens.spacing.screenX}>
          <ErrorState
            title={t('downloads.detailsErrorTitle')}
            message={loadError || 'Something went wrong while loading this download.'}
            onRetry={handleRetry}
            testID="download-details-error"
          />
        </Box>
      ) : null}

      {status === 'missing' ? (
        <Box flex={1} center px={downloadsTokens.spacing.screenX}>
          <EmptyState
            icon="download-off-outline"
            title={t('downloads.detailsMissingTitle')}
            description={t('downloads.detailsMissingDescription')}
            actionLabel={t('downloads.detailsMissingAction')}
            onActionPress={goBack}
            testID="download-details-missing"
          />
        </Box>
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
          folderLabel={folderLabel}
          folderPending={folderPending}
          onOpenFolderPicker={handleOpenFolderPicker}
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

      <ActionSheetModal
        visible={fileActionsVisible}
        onClose={() => setFileActionsVisible(false)}
        title={t('files.actionsTitle')}
        subtitle={t('files.actionsSubtitle')}
        actions={fileActions}
        testID="download-details-file-actions-sheet"
      />

      <AppModal
        visible={renameFileVisible}
        onClose={cancelRenameFile}
        title={t('files.renameFile')}
        subtitle={t('downloads.renameDisplayName')}
        showCloseButton>
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
            {renameFileError && !renameFileDraft.trim() ? (
              <Text variant="caption" color="error">
                {renameFileError}
              </Text>
            ) : null}
          </Box>

          <Box row gap={12}>
            <Box flex={1}>
              <Button
                title={t('common.save')}
                onPress={() => {
                  void confirmRenameFile();
                }}
                loading={renameFileBusy}
                disabled={renameFileBusy || !renameFileDraft.trim()}
                fullWidth
              />
            </Box>
            <Box flex={1}>
              <Button
                title={t('common.cancel')}
                variant="outline"
                onPress={cancelRenameFile}
                disabled={renameFileBusy}
                fullWidth
              />
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
              onPress={() => {
                void createFolderNow();
              }}
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
                  <Button
                    title={t('common.save')}
                    onPress={() => {
                      void confirmRenameFolder();
                    }}
                    loading={renameBusy}
                    disabled={renameBusy}
                    fullWidth
                  />
                </Box>
                <Box flex={1}>
                  <Button
                    title={t('common.cancel')}
                    variant="outline"
                    onPress={cancelRenameFolder}
                    disabled={renameBusy}
                    fullWidth
                  />
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
                    <Box
                      key={id}
                      row
                      center
                      style={{ justifyContent: 'space-between', gap: 12 }}>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text variant="bodySmall" color="textPrimary" numberOfLines={1}>
                          {folder.name}
                        </Text>
                      </Box>

                      <Box row gap={8}>
                        <Button
                          title={t('files.rename')}
                          variant="outline"
                          size="small"
                          onPress={() => startRenameFolder(id)}
                          disabled={renameBusy || createBusy}
                        />
                        <Button
                          title={t('common.delete')}
                          variant="destructive"
                          size="small"
                          onPress={() => requestDeleteFolder(id)}
                          disabled={renameBusy || createBusy}
                        />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}

            {createError && (
              <Text variant="caption" color="error">
                {createError}
              </Text>
            )}
            {renameError && !renameTargetId ? (
              <Text variant="caption" color="error">
                {renameError}
              </Text>
            ) : null}
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
        onConfirm={() => {
          void confirmDeleteFolder();
        }}
        onCancel={cancelDeleteFolder}
        testID="download-details-delete-folder-dialog"
      />
    </SafeAreaScreen>
  );
});
