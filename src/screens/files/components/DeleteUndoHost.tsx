import { memo, useCallback, useEffect, useSyncExternalStore } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { Pressable } from '@/components/base/Pressable';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { ds, DsText } from '@/design';
import {
  binIsOn,
  deleteUndoSnackbar,
  runDelete,
  undoDelete,
  useDeleteConfirmStore,
} from '@/files/trash/useDeleteWithUndo';
import { getBinSettings } from '@/files/ui/trash-port';
import { UNDO_VISIBLE_MS, type UndoOffer } from '@/files/ui/undo-snackbar';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslateFn } from '@/localization';

import { announce } from '../announce';

/** The bar's words: "3 files moved to Recycle bin", "1 file deleted", and "2 couldn't be deleted" after either. */
function offerMessage(offer: UndoOffer, t: TranslateFn): string {
  const parts: string[] = [];
  const moved = offer.trashedIds.length;
  if (moved > 0) parts.push(moved === 1 ? t('fileManager.undoMovedOne') : t('fileManager.undoMovedOther', { count: moved }));
  if (offer.deletedCount > 0) {
    parts.push(offer.deletedCount === 1 ? t('fileManager.undoDeletedOne') : t('fileManager.undoDeletedOther', { count: offer.deletedCount }));
  }
  if (offer.failedCount > 0) parts.push(t('fileManager.undoFailed', { count: offer.failedCount }));
  return parts.join(' · ');
}

/**
 * Files F8: every delete's Confirm before delete dialog and its "… · Undo" bar, for the whole app (mounted once, so the
 * bar outlives the screen the delete came from). With the bin on: "Move to Recycle bin?" and Undo; off: "Delete …
 * forever?" and no Undo.
 */
export const DeleteUndoHost = memo(function DeleteUndoHost() {
  return (
    <>
      <DeleteConfirm />
      <UndoBar />
    </>
  );
});

function DeleteConfirm() {
  const { t } = useTranslation();
  const pending = useDeleteConfirmStore((state) => state.pending);
  const busy = useDeleteConfirmStore((state) => state.busy);
  if (!pending) {
    return null;
  }
  const count = pending.ids.length;
  const toBin = binIsOn();
  const keepDays = getBinSettings().keepDays;
  const title = toBin
    ? count === 1
      ? t('fileManager.toBinTitleOne')
      : t('fileManager.toBinTitleOther', { count })
    : count === 1 && pending.name
      ? t('fileManager.foreverTitleOne', { name: pending.name })
      : t('fileManager.foreverTitleOther', { count });
  const message = toBin
    ? keepDays === null
      ? t('fileManager.toBinMessageForever')
      : t('fileManager.toBinMessageDays', { days: keepDays })
    : t('fileManager.foreverMessage');
  return (
    <ConfirmModal
      visible
      variant="delete"
      title={title}
      message={message}
      confirmLabel={toBin ? t('fileManager.toBinConfirm') : t('common.delete')}
      cancelLabel={t('common.cancel')}
      loading={busy}
      onConfirm={() => {
        useDeleteConfirmStore.setState({ busy: true });
        void runDelete(pending).finally(() => useDeleteConfirmStore.setState({ pending: null, busy: false }));
      }}
      onCancel={() => {
        if (!useDeleteConfirmStore.getState().busy) useDeleteConfirmStore.setState({ pending: null });
      }}
      testID="files-delete-confirm"
    />
  );
}

function UndoBar() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const offer = useSyncExternalStore(deleteUndoSnackbar.subscribe, deleteUndoSnackbar.get, deleteUndoSnackbar.get);

  useEffect(() => {
    if (!offer) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Android's "Time to take action" accessibility setting can ask for longer.
    void AccessibilityInfo.getRecommendedTimeoutMillis(UNDO_VISIBLE_MS)
      .catch(() => UNDO_VISIBLE_MS)
      .then((visibleMs) => {
        if (cancelled) return;
        deleteUndoSnackbar.extend(offer.batchId, visibleMs);
        const remaining = Math.max(0, offer.shownAt + Math.max(UNDO_VISIBLE_MS, visibleMs) - Date.now());
        timer = setTimeout(() => deleteUndoSnackbar.dismiss(offer.batchId), remaining);
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [offer]);

  const message = offer ? offerMessage(offer, t) : '';

  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  const undo = useCallback(() => {
    if (!offer) return;
    void undoDelete(offer.batchId)
      .then((count) => {
        if (count > 0) announce(count === 1 ? t('fileManager.binRestoredOne') : t('fileManager.binRestoredOther', { count }));
      })
      .catch(() => announce(t('fileManager.binFailed')));
  }, [offer, t]);

  if (!offer || !message) {
    return null;
  }
  return (
    <Animated.View
      entering={FadeInDown.duration(160)}
      exiting={FadeOutDown.duration(160)}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: ds.space.screenX, right: ds.space.screenX, bottom: 84, zIndex: 50, elevation: 6 }}>
      <View
        testID="files-undo-bar"
        accessibilityLiveRegion="polite"
        style={{
          minHeight: 52,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.textPrimary,
          flexDirection: rtl.rowDirection,
          alignItems: 'center',
          paddingHorizontal: 16,
          gap: 8,
          elevation: 6,
        }}>
        <DsText variant="body" color={theme.colors.background} numberOfLines={2} style={{ flex: 1 }}>
          {message}
        </DsText>
        {offer.trashedIds.length > 0 ? (
          <Pressable
            testID="files-undo-bar-action"
            accessibilityRole="button"
            accessibilityLabel={t('fileManager.undoA11y')}
            onPress={undo}
            style={{ minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
            <DsText variant="button" color={theme.colors.background}>
              {t('fileManager.undoAction')}
            </DsText>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}
