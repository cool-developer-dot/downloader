import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, View, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsButton, DsCard, DsHeader, DsIcon, DsText } from '@/design';
import { fileBytes, fileLabel } from '@/files/ui/file-fields';
import type { FileEntry } from '@/files/ui/files-index';
import { useLockedNowIds } from '@/files/ui/locked-folders';
import { useTheme } from '@/hooks/use-theme';
import { formatFileSize } from '@/media-detection/utils/format';
import { useTranslation } from '@/localization';
import { canMoveToPrivate, moveLibraryItemToPrivate } from '@/private-vault/move-to-private.runtime';
import { vaultSealedLength } from '@/private-vault/vault-format';
import { usePrivateVaultPrefs } from '@/private-vault/vault-prefs-store';

import { announce } from '../files/announce';
import { listVisibleFiles } from '../files/hooks/use-files-data';
import { fileTypeIcon } from '../files/utils/file-rows';
import { PrivateCheckbox } from './PrivateCheckbox';

export type AddFilesModalProps = {
  visible: boolean;
  onClose: () => void;
  /** After a move: the vault reloads. */
  onMoved: () => void;
};

type Phase = { kind: 'pick' } | { kind: 'confirm' } | { kind: 'moving'; done: number; total: number };

/**
 * Design 29's "+ Add files" (Files F10): a picker of library files, inside Private (a new screen would lock it), whose
 * picked files move in one after another through the existing move (`moveLibraryItemToPrivate`: encrypt, remove the
 * original through the app's delete path, forget its history). One confirm covers the batch; the very first move still
 * needs "I understand". F4's selection replaces this picker's own ticks later.
 */
export const AddFilesModal = memo(function AddFilesModal({ visible, onClose, onMoved }: AddFilesModalProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const acknowledged = usePrivateVaultPrefs((s) => s.dataLossAcknowledged);
  const lockedNow = useLockedNowIds();
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [understood, setUnderstood] = useState(false);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    let live = true;
    // A locked folder's files stay out of the picker until it is opened (they are hidden everywhere else too).
    void listVisibleFiles(lockedNow)
      .catch(() => [] as FileEntry[])
      .then((all) => {
        if (live) setFiles(all.filter((file) => canMoveToPrivate(file.id)));
      });
    return () => {
      live = false;
    };
  }, [lockedNow, visible]);

  const shown = files;
  const pickedFiles = useMemo(() => (shown ?? []).filter((file) => picked.has(file.id)), [picked, shown]);
  const spaceLabel = formatFileSize(pickedFiles.reduce((sum, file) => sum + vaultSealedLength(fileBytes(file)), 0));

  const reset = useCallback(() => {
    setPicked(new Set());
    setPhase({ kind: 'pick' });
    setUnderstood(false);
    setFiles(null);
  }, []);

  const close = useCallback(() => {
    if (phase.kind === 'moving') return;
    reset();
    onClose();
  }, [onClose, phase.kind, reset]);

  const toggle = useCallback((id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const move = useCallback(async () => {
    const prefs = usePrivateVaultPrefs.getState();
    if (!prefs.dataLossAcknowledged) {
      if (!understood) return;
      prefs.acknowledgeDataLoss();
    }
    const ids = pickedFiles.map((file) => file.id);
    let moved = 0;
    for (let index = 0; index < ids.length; index += 1) {
      setPhase({ kind: 'moving', done: index + 1, total: ids.length });
      const result = await moveLibraryItemToPrivate(ids[index]!).catch(() => ({ ok: false as const }));
      if (result.ok) moved += 1;
    }
    if (moved > 0) announce(t('fileManager.addFilesDone', { count: moved }));
    if (moved < ids.length) announce(t('fileManager.addFilesFailed', { count: ids.length - moved }));
    reset();
    onMoved();
    onClose();
  }, [onClose, onMoved, pickedFiles, reset, t, understood]);

  const renderFile = useCallback<ListRenderItem<FileEntry>>(
    ({ item }) => {
      const on = picked.has(item.id);
      return (
        <Pressable
          onPress={() => toggle(item.id)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          accessibilityLabel={t('fileManager.selectFileA11y', { name: fileLabel(item), state: on ? t('fileManager.selected') : t('fileManager.notSelected') })}
          testID={`private-add-${item.id}`}
          style={({ pressed }) => ({
            flexDirection: rtl.rowDirection,
            alignItems: 'center',
            gap: ds.space.rowGap,
            paddingVertical: 10,
            paddingHorizontal: ds.space.cardPad,
            backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
          })}>
          <DsIcon name={on ? 'square-check' : 'square'} size={22} color={on ? 'primary' : 'textSecondary'} strokeWidth={1.8} />
          <DsIcon name={fileTypeIcon(item.fileType)} size={18} color="primary" strokeWidth={1.6} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <DsText variant="rowTitle" numberOfLines={1}>
              {fileLabel(item)}
            </DsText>
            <DsText variant="rowSub" numberOfLines={1}>
              {formatFileSize(fileBytes(item)) ?? ''}
            </DsText>
          </View>
        </Pressable>
      );
    },
    [picked, rtl.rowDirection, t, theme.colors.surfacePressed, toggle],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }} testID="private-add-files">
        <View style={{ paddingHorizontal: ds.space.screenX }}>
          <DsHeader
            title={t('fileManager.addFilesTitle')}
            subtitle={t('fileManager.addFilesHint')}
            action={{ icon: 'x', accessibilityLabel: t('common.close'), onPress: close, testID: 'private-add-close' }}
          />
        </View>
        {phase.kind === 'pick' ? (
          <FlatList
            data={shown ?? []}
            keyExtractor={(file) => file.id}
            renderItem={renderFile}
            contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 16 }}
            ListEmptyComponent={
              shown === null ? (
                <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} style={{ marginTop: 24 }} />
              ) : (
                <DsCard>
                  <DsText variant="body" align="center">
                    {t('fileManager.addFilesNone')}
                  </DsText>
                </DsCard>
              )
            }
          />
        ) : (
          <View style={{ flex: 1, paddingHorizontal: ds.space.screenX, gap: 14, paddingTop: 8 }}>
            {phase.kind === 'moving' ? (
              <View style={{ alignItems: 'center', gap: 12, paddingTop: 24 }}>
                <ActivityIndicator color={theme.colors.primary} />
                <DsText variant="bodyStrong" align="center" accessibilityLiveRegion="polite">
                  {t('fileManager.addFilesMoving', { done: phase.done, total: phase.total })}
                </DsText>
              </View>
            ) : (
              <DsCard>
                <View style={{ gap: 12 }}>
                  <DsText variant="bodyStrong">{t('fileManager.addFilesConfirmTitle', { count: pickedFiles.length })}</DsText>
                  <DsText variant="body">{t('fileManager.addFilesConfirmMessage', { size: spaceLabel ?? '' })}</DsText>
                  <DsText variant="body">{t('privateVault.dataLossCompact')}</DsText>
                  {acknowledged ? null : (
                    <PrivateCheckbox
                      checked={understood}
                      onToggle={() => setUnderstood((value) => !value)}
                      label={t('privateVault.dataLossAcknowledge')}
                      testID="private-add-understood"
                    />
                  )}
                </View>
              </DsCard>
            )}
          </View>
        )}
        <View style={{ paddingHorizontal: ds.space.screenX, paddingVertical: 12, gap: 8 }}>
          {phase.kind === 'pick' ? (
            <DsButton
              label={t('fileManager.addFilesMove', { count: pickedFiles.length })}
              icon="lock"
              onPress={() => setPhase({ kind: 'confirm' })}
              disabled={pickedFiles.length === 0}
              fullWidth
              testID="private-add-next"
            />
          ) : phase.kind === 'confirm' ? (
            <>
              <DsButton
                label={t('privateVault.moveConfirm')}
                onPress={() => void move()}
                disabled={!acknowledged && !understood}
                fullWidth
                testID="private-add-move"
              />
              <DsButton label={t('common.cancel')} variant="secondary" onPress={() => setPhase({ kind: 'pick' })} fullWidth />
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
});
