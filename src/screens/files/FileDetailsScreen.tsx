import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { ds, DsButton, DsButtonRow, DsCard, DsHeader, DsIcon, DsRow, DsRowGroup, DsScreen, DsText, DsThumb } from '@/design';
import { completedActionErrorMessageKey } from '@/downloads/completed-file/action-errors';
import { fileIntegrity, storedChecksum } from '@/downloads/v2/file-integrity';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { fileBytes, fileLabel } from '@/files/ui/file-fields';
import { fileTypeOf, folderPath, fullPathOf, type FileEntry } from '@/files/ui/files-source';
import { useItemNotesStore, useItemTagsStore } from '@/library/item-organize-store';
import { formatDuration } from '@/media-detection/utils/format';
import { intlLocaleForLanguage, useTranslation, type TranslationKey } from '@/localization';
import { fileChecksumPath, navigation, openPlayer } from '@/navigation';
import { DownloadSafetySection } from '@/screens/downloads/components/DownloadSafetySection';
import { useDownloadDetailsScreen } from '@/screens/downloads/hooks/useDownloadDetailsScreen';
import { formatDownloadDate, formatDurableBitrate, formatSourceHost } from '@/screens/downloads/utils/download-format';

import { announce } from './announce';
import { listAllFiles } from './hooks/use-files-data';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';
import { exactBytes, formatLine, pathLine, tagsOf } from './utils/details-rows';
import { fileTypeIcon, formatFileBytes } from './utils/file-rows';

/** What the native library knows about the file (codecs, picture size, length, its page). */
type MediaInfo = {
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasAudio: boolean;
  pageUrl: string | null;
  fileUri: string | null;
  thumbnailUri: string | null;
};

type Expanded = 'size' | 'format' | 'modified' | 'path' | null;

/**
 * Design 56 "File details" (Files F3, `/files/details/[id]`): the preview card (#866 — a video's poster with ▶ that
 * opens the Player, an image itself, a music icon with the length, or the type's icon), Size (tap: the exact bytes),
 * Format "MP4 · 640×356" (tap: codecs, bitrate and length, #829), Modified (tap: created and downloaded, #833), Path
 * "Files › Movies" (tap: the full path from `fullPathOf`, with Copy), Checksum (its own page), Notes (#941, the
 * existing notes store: add, edit, delete), Tags (read only; F7 edits them), Source page, and Play / Share. An APK
 * keeps P8's malware warning and never gets an install button. The download's data comes from Download details' own
 * hook (`useDownloadDetailsScreen`), not a copy of it.
 */
export const FileDetailsScreen = memo(function FileDetailsScreen() {
  const { t, language } = useTranslation();
  const model = useDownloadDetailsScreen();
  const { item, downloadId: id } = model;
  const settingsAction = useFilesSettingsAction();
  const locale = intlLocaleForLanguage(language);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [entry, setEntry] = useState<FileEntry | null>(null);
  const [folderNames, setFolderNames] = useState<string[]>([]);
  const [fullPath, setFullPath] = useState<string | null | undefined>(undefined);
  const [sha256, setSha256] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const note = useItemNotesStore((s) => (id ? (s.notesById[id] ?? '') : ''));
  // One shared empty list for an untagged file (a new `[]` here would re-render without end).
  const tags = useItemTagsStore((s) => tagsOf(s.tagsById, id));

  // The native library's view of the file, its place in Files, and a stored checksum.
  useEffect(() => {
    if (!id) {
      return undefined;
    }
    let live = true;
    void getV2Engine()
      ?.getLibraryItem(id)
      .then((libraryItem) => {
        if (live && libraryItem) {
          setMedia({
            videoCodec: libraryItem.videoCodec,
            audioCodec: libraryItem.audioCodec,
            width: libraryItem.width,
            height: libraryItem.height,
            durationMs: libraryItem.durationMs,
            hasAudio: libraryItem.hasAudio,
            pageUrl: libraryItem.pageUrl,
            fileUri: libraryItem.fileUri,
            thumbnailUri: libraryItem.thumbnailUri,
          });
        }
      })
      .catch(() => undefined);
    void listAllFiles()
      .then(async (files) => {
        const found = files.find((file) => file.id === id) ?? null;
        const path = found?.folderId ? await folderPath(found.folderId) : [];
        if (live) {
          setEntry(found);
          setFolderNames(path.map((folder) => folder.name));
        }
      })
      .catch(() => undefined);
    void storedChecksum(fileIntegrity(), id).then((state) => {
      if (live) setSha256(state?.sha256 ?? null);
    });
    return () => {
      live = false;
    };
  }, [id]);

  const name = item?.fileName?.trim() || item?.title?.trim() || (entry ? fileLabel(entry) : '');
  const type = fileTypeOf(item?.mimeType ?? entry?.mimeType ?? null, name);
  const audioOnly = type === 'audio';
  const sizeBytes = Number(item?.fileSize ?? 0) || (entry ? fileBytes(entry) : 0);
  const resolution =
    media?.width && media.height ? `${media.width}x${media.height}` : (item?.resolution ?? null);
  const format = formatLine({ mimeType: item?.mimeType ?? null, fileName: name, resolution, audioOnly });
  const durationSeconds = media?.durationMs != null ? media.durationMs / 1000 : null;
  const formatDetails = [
    media?.videoCodec && !audioOnly ? t('fileManager.formatVideoCodec', { codec: media.videoCodec }) : null,
    media?.audioCodec ? t('fileManager.formatAudioCodec', { codec: media.audioCodec }) : null,
    formatDurableBitrate(item?.bitrate) ? t('fileManager.formatBitrate', { bitrate: formatDurableBitrate(item?.bitrate) ?? '' }) : null,
    durationSeconds ? t('fileManager.formatDuration', { duration: formatDuration(durationSeconds) ?? '' }) : null,
  ].filter((line): line is string => Boolean(line));
  const downloaded = formatDownloadDate(item?.downloadedAt ?? entry?.downloadedAt ?? null);
  const created = formatDownloadDate(item?.createdAt ?? null);
  const source = item?.sourceUrl || media?.pageUrl || '';
  const playable = type === 'video' || type === 'audio';

  const toggle = useCallback((row: Expanded) => setExpanded((current) => (current === row ? null : row)), []);

  const showPath = useCallback(() => {
    toggle('path');
    if (fullPath === undefined && id) {
      void fullPathOf(id).then((paths) => setFullPath(paths?.appPath ?? null));
    }
  }, [fullPath, id, toggle]);

  const play = useCallback(() => {
    if (id) openPlayer(id, [id]);
  }, [id]);

  const share = useCallback(async () => {
    if (!id) return;
    try {
      const { shareCompletedFile } = await import('@/downloads/completed-file/action-service');
      const result = await shareCompletedFile(id);
      if (!result.ok) announce(t(completedActionErrorMessageKey(result.error.code) as TranslationKey));
    } catch {
      announce(t('files.shareFailed'));
    }
  }, [id, t]);

  const preview = useMemo(() => {
    if (type === 'video') {
      return (
        <Pressable onPress={play} accessibilityRole="button" accessibilityLabel={t('fileManager.previewPlayA11y', { name })} testID="files-details-preview">
          <DsThumb uri={media?.thumbnailUri ?? entry?.thumbnailUri ?? null} kind="video" width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} radius={ds.radius.tile} />
        </Pressable>
      );
    }
    if (type === 'image' && media?.fileUri) {
      return <Image source={{ uri: media.fileUri }} style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, borderRadius: ds.radius.tile }} contentFit="contain" accessibilityLabel={name} />;
    }
    return (
      <View style={{ alignItems: 'center', gap: 6, paddingVertical: 12 }}>
        <DsIcon name={fileTypeIcon(type)} size={40} color="primary" strokeWidth={1.6} accessibilityLabel={name} />
        {type === 'audio' && durationSeconds ? <DsText variant="body">{formatDuration(durationSeconds)}</DsText> : null}
      </View>
    );
  }, [durationSeconds, entry?.thumbnailUri, media?.fileUri, media?.thumbnailUri, name, play, t, type]);

  if (!id || model.status === 'missing' || model.status === 'error') {
    return (
      <DsScreen edges={['top', 'bottom']} testID="files-details-missing">
        <DsHeader title={t('fileManager.details')} onBack={model.goBack} action={settingsAction} />
        <DsCard>
          <DsText variant="body">{t('fileManager.detailsMissing')}</DsText>
        </DsCard>
      </DsScreen>
    );
  }

  if (!item) {
    return (
      <DsScreen edges={['top', 'bottom']}>
        <DsHeader title={t('fileManager.details')} onBack={model.goBack} action={settingsAction} />
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      </DsScreen>
    );
  }

  return (
    <DsScreen edges={['top', 'bottom']} testID="files-details-screen">
      <DsHeader title={t('fileManager.details')} subtitle={name} onBack={model.goBack} action={settingsAction} testID="files-details-header" />
      <DsCard testID="files-details-preview-card">
        <View style={{ alignItems: 'center' }}>{preview}</View>
      </DsCard>
      {/* P8 #461: an APK (or a file that isn't what its name says) keeps the malware warning. Never an install button. */}
      <DownloadSafetySection id={id} fileName={name} />
      <DsRowGroup testID="files-details-rows">
        <DsRow
          icon="sliders-horizontal"
          title={t('fileManager.rowSize')}
          subtitle={
            expanded === 'size'
              ? t('fileManager.rowSizeExact', { bytes: exactBytes(sizeBytes, locale) })
              : (formatFileBytes(sizeBytes) ?? '—')
          }
          onPress={() => toggle('size')}
          testID="files-details-size"
        />
        <DsRow
          icon="film"
          title={t('fileManager.rowFormat')}
          subtitle={[format ?? '—', ...(expanded === 'format' ? formatDetails : [])].join('\n')}
          onPress={() => toggle('format')}
          testID="files-details-format"
        />
        <DsRow
          icon="calendar"
          title={t('fileManager.rowModified')}
          subtitle={
            expanded === 'modified'
              ? [created ? t('fileManager.modifiedCreated', { date: created }) : null, downloaded ? t('fileManager.modifiedDownloaded', { date: downloaded }) : null]
                  .filter(Boolean)
                  .join('\n')
              : (downloaded ?? created ?? '—')
          }
          onPress={() => toggle('modified')}
          testID="files-details-modified"
        />
        <DsRow
          icon="folder"
          title={t('fileManager.rowPath')}
          subtitle={
            expanded === 'path'
              ? `${pathLine(t('filesTab.title'), folderNames)}\n${fullPath === undefined ? t('common.loading') : (fullPath ?? t('fileManager.fullPathUnknown'))}`
              : pathLine(t('filesTab.title'), folderNames)
          }
          onPress={showPath}
          trailing={
            expanded === 'path' && fullPath ? (
              <DsButton
                label={t('fileManager.copy')}
                variant="secondary"
                onPress={() => void Clipboard.setStringAsync(fullPath).then(() => announce(t('fileManager.copied')))}
                testID="files-details-copy-path"
              />
            ) : undefined
          }
          testID="files-details-path"
        />
        <DsRow
          icon="check"
          title={t('fileManager.rowChecksum')}
          subtitle={sha256 ? `${t('lightFileActions.sha256')} · ${sha256.slice(0, 16)}…` : t('lightFileActions.sha256')}
          onPress={() => navigation.push(fileChecksumPath(id))}
          testID="files-details-checksum"
        />
        <DsRow
          icon="notebook-pen"
          title={t('fileManager.rowNotes')}
          subtitle={note || t('fileManager.notesAdd')}
          onPress={() => {
            setNoteDraft(note);
            setNoteOpen(true);
          }}
          testID="files-details-notes"
        />
        <DsRow icon="tag" title={t('fileManager.rowTags')} subtitle={tags.length > 0 ? tags.join(', ') : t('fileManager.tagsNone')} testID="files-details-tags" />
        <DsRow
          icon="globe"
          title={t('fileManager.rowSource')}
          subtitle={source ? (formatSourceHost(source) ?? source) : t('fileManager.sourceNone')}
          testID="files-details-source"
        />
      </DsRowGroup>
      <DsButtonRow>
        {playable ? <DsButton label={t('common.play')} icon="play" onPress={play} flex testID="files-details-play" /> : null}
        <DsButton label={t('common.share')} icon="share-2" variant="secondary" onPress={() => void share()} flex testID="files-details-share" />
      </DsButtonRow>

      <AppModal visible={noteOpen} onClose={() => setNoteOpen(false)} title={t('fileManager.notesTitle')} showCloseButton testID="files-details-note-modal">
        <View style={{ gap: 12 }}>
          <TextField value={noteDraft} onChangeText={setNoteDraft} multiline autoFocus label={t('fileManager.notesTitle')} testID="files-details-note-input" />
          <DsButtonRow>
            <DsButton
              label={t('common.save')}
              onPress={() => {
                useItemNotesStore.getState().setNote(id, noteDraft);
                announce(t('organize.noteSaved'));
                setNoteOpen(false);
              }}
              flex
              testID="files-details-note-save"
            />
            {note ? (
              <DsButton
                label={t('fileManager.notesDelete')}
                variant="secondary"
                onPress={() => {
                  useItemNotesStore.getState().setNote(id, '');
                  setNoteOpen(false);
                }}
                flex
                testID="files-details-note-delete"
              />
            ) : null}
          </DsButtonRow>
        </View>
      </AppModal>
    </DsScreen>
  );
});

const PREVIEW_WIDTH = 300;
const PREVIEW_HEIGHT = 170;
