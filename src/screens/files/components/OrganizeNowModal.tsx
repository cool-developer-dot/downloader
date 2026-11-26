import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsChip, DsChipRow, DsRow, DsRowGroup, DsText } from '@/design';
import { ORGANIZE_BY, planAutoOrganize, siteOf, type OrganizeBy, type OrganizePlan } from '@/files/organize/auto-organize';
import { createFolder, listFolder, type FileEntry, type FolderEntry } from '@/files/ui/files-source';
import { intlLocaleForLanguage, useTranslation, type TranslationKey } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';

import { announce } from '../announce';
import { tileLabelKey, type TileType } from '../utils/type-tiles';

const BY_LABELS: Record<OrganizeBy, TranslationKey> = {
  type: 'fileManager.organizeByType',
  site: 'fileManager.organizeBySite',
  month: 'fileManager.organizeByMonth',
};

export type OrganizeNowModalProps = { visible: boolean; onClose: () => void; onDone: () => void };

/**
 * Files F7 · #937 Auto organize (Files tab ⋮ → Organize now): files in no folder go into folders by Type, Site or
 * Month. The plan shows first ("12 files into 3 folders"); folders of the same name are reused. The download rules
 * (save location by type and by site) are not touched.
 */
export const OrganizeNowModal = memo(function OrganizeNowModal({ visible, onClose, onDone }: OrganizeNowModalProps) {
  const { t, language } = useTranslation();
  const [by, setBy] = useState<OrganizeBy>('type');
  const [source, setSource] = useState<{ files: FileEntry[]; folders: FolderEntry[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;
    let live = true;
    void listFolder(null)
      .then((listing) => {
        if (live) setSource({ files: listing.files, folders: listing.folders });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [visible]);

  const plan = useMemo<OrganizePlan | null>(() => {
    if (!source) return null;
    const items = useDownloadsStore.getState().itemsById;
    const monthFormat = new Intl.DateTimeFormat(intlLocaleForLanguage(language), { month: 'long', year: 'numeric' });
    return planAutoOrganize(
      source.files.map((file) => ({ id: file.id, type: file.fileType, folderId: file.folderId, date: file.downloadedAt, site: siteOf(items[file.id]?.sourceUrl) })),
      source.folders,
      by,
      {
        type: (type) => (type === 'other' ? t('fileManager.organizeOther') : t(tileLabelKey(type as TileType))),
        month: (iso) => monthFormat.format(new Date(iso)),
        other: t('fileManager.organizeOther'),
      },
    );
  }, [by, language, source, t]);

  const apply = useCallback(async () => {
    if (!plan || !source) return;
    setBusy(true);
    let moved = 0;
    const store = useMediaFolderAssignmentsStore.getState();
    for (const group of plan.groups) {
      try {
        const folderId = group.folderId ?? (await createFolder(group.name, null)).id;
        for (const id of group.fileIds) {
          await store.moveMediaToFolder({ mediaId: id, desiredFolderId: folderId, fallbackFolderId: null }).catch(() => undefined);
          moved += 1;
        }
      } catch {
        // the next group still goes
      }
    }
    setBusy(false);
    announce(t('fileManager.organizeDone', { count: moved }));
    onDone();
    onClose();
  }, [onClose, onDone, plan, source, t]);

  return (
    <AppModal visible={visible} onClose={busy ? undefined : onClose} title={t('fileManager.organizeNow')} showCloseButton={!busy} testID="files-organize">
      <View style={{ gap: 12 }}>
        <DsText variant="body">{t('fileManager.organizeBy')}</DsText>
        <DsChipRow scroll={false}>
          {ORGANIZE_BY.map((value) => (
            <DsChip key={value} label={t(BY_LABELS[value])} selected={by === value} onPress={() => setBy(value)} testID={`files-organize-${value}`} />
          ))}
        </DsChipRow>
        {!plan ? (
          <ActivityIndicator />
        ) : plan.fileCount === 0 ? (
          <DsText variant="bodyStrong">{t('fileManager.organizeNothing')}</DsText>
        ) : (
          <>
            <DsText variant="bodyStrong" accessibilityLiveRegion="polite" testID="files-organize-preview">
              {t('fileManager.organizePreview', { files: plan.fileCount, folders: plan.folderCount })}
            </DsText>
            {plan.newFolderCount > 0 ? <DsText variant="rowSub">{t('fileManager.organizeNewFolders', { count: plan.newFolderCount })}</DsText> : null}
            <DsRowGroup>
              {plan.groups.slice(0, 8).map((group) => (
                <DsRow key={group.name} icon="folder" title={group.name} value={String(group.fileIds.length)} />
              ))}
            </DsRowGroup>
          </>
        )}
        <DsText variant="rowSub">{t('fileManager.organizeNote')}</DsText>
        <DsButton
          label={t('fileManager.organizeApply')}
          onPress={() => void apply()}
          loading={busy}
          disabled={busy || !plan || plan.fileCount === 0}
          fullWidth
          testID="files-organize-apply"
        />
      </View>
    </AppModal>
  );
});
