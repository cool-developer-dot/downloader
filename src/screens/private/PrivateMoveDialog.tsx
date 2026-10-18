import { memo, useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { AppModal } from '@/components/modals/AppModal';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTranslation } from '@/localization';
import { moveConfirmGate } from '@/private-vault/data-loss';
import { usePrivateVaultPrefs } from '@/private-vault/vault-prefs-store';

import { PrivateCheckbox } from './PrivateCheckbox';
import { PrivateDataLossNotice } from './PrivateDataLossNotice';
import type { PrivateMoveController, PrivateMoveDialogState } from './usePrivateMove';

export type PrivateMoveDialogProps = {
  controller: PrivateMoveController;
  testID?: string;
};

type ConfirmState = Extract<PrivateMoveDialogState, { kind: 'confirm' | 'moving' }>;

/**
 * The confirm of a move. It always says that private videos live only on this phone and are lost for good if VidoraX
 * is uninstalled or its data is cleared; the very first move also needs "I understand" ticked. A video with a Gallery
 * copy offers "Also remove the Gallery copy" (off by default).
 */
function MoveConfirm({
  dialog,
  onConfirm,
  onCancel,
  testID,
}: {
  dialog: ConfirmState;
  onConfirm: (understood: boolean, removeGallery: boolean) => void;
  onCancel: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const acknowledged = usePrivateVaultPrefs((s) => s.dataLossAcknowledged);
  const [ticked, setTicked] = useState(false);
  const [removeGallery, setRemoveGallery] = useState(false);
  const moving = dialog.kind === 'moving';
  const gate = moveConfirmGate({ acknowledged, ticked, busy: moving });

  return (
    <AppModal visible onClose={moving ? undefined : onCancel} showCloseButton={false} testID={testID}>
      <Box gap={14}>
        <Text variant="title">{t('privateVault.moveTitle')}</Text>
        <ScrollView style={{ maxHeight: height * 0.5, flexGrow: 0 }} contentContainerStyle={{ gap: 12 }}>
          {moving ? (
            <Text variant="bodySmall" color="textSecondary" accessibilityLiveRegion="polite">
              {dialog.percent ? t('privateVault.moving', { percent: dialog.percent }) : t('privateVault.movingPlain')}
            </Text>
          ) : (
            <>
              <Text variant="bodySmall" color="textSecondary">
                {t('privateVault.moveMessage', { title: dialog.title, size: dialog.spaceLabel ?? '' })}
              </Text>
              {dialog.inGallery ? (
                <Text variant="bodySmall" color="textSecondary">
                  {t('privateVault.moveGalleryNote')}
                </Text>
              ) : null}
              {dialog.kind === 'confirm' && dialog.canRemoveGallery ? (
                <Box gap={4}>
                  <PrivateCheckbox
                    checked={removeGallery}
                    onToggle={() => setRemoveGallery((value) => !value)}
                    label={t('privateVault.removeGalleryCopy')}
                    testID={`${testID}-remove-gallery`}
                  />
                  <Text variant="caption" color="textSecondary">
                    {t('privateVault.removeGalleryCopyHint')}
                  </Text>
                </Box>
              ) : null}
            </>
          )}
          <PrivateDataLossNotice testID={`${testID}-data-loss`} />
          {gate.showAcknowledgement ? (
            <PrivateCheckbox
              checked={ticked}
              onToggle={() => setTicked((value) => !value)}
              label={t('privateVault.dataLossAcknowledge')}
              disabled={moving}
              testID={`${testID}-understand`}
            />
          ) : null}
        </ScrollView>
        <Box row rtlRow gap={12}>
          <Box flex={1}>
            <Button title={t('common.cancel')} variant="outline" onPress={onCancel} disabled={moving} fullWidth />
          </Box>
          <Box flex={1}>
            <Button
              title={t('privateVault.moveConfirm')}
              onPress={() => onConfirm(ticked, removeGallery)}
              disabled={!gate.canConfirm}
              loading={moving}
              fullWidth
              testID={`${testID}-move`}
            />
          </Box>
        </Box>
      </Box>
    </AppModal>
  );
}

/** The dialogs of "Move to Private": set up App Lock first, the confirm with its data-loss warning, the progress. */
export const PrivateMoveDialog = memo(function PrivateMoveDialog({
  controller,
  testID = 'private-move-dialog',
}: PrivateMoveDialogProps) {
  const { t } = useTranslation();
  const { dialog, confirm, cancel, setUpAppLock } = controller;

  if (dialog.kind === 'needs-app-lock') {
    return (
      <ConfirmModal
        visible
        variant="warning"
        title={t('privateVault.needsAppLockTitle')}
        message={t('privateVault.needsAppLockMessage')}
        confirmLabel={t('privateVault.setUpAppLock')}
        cancelLabel={t('privateVault.notNow')}
        onConfirm={setUpAppLock}
        onCancel={cancel}
        testID={`${testID}-app-lock`}
      />
    );
  }

  if (dialog.kind === 'confirm' || dialog.kind === 'moving') {
    return (
      <MoveConfirm
        key={dialog.id}
        dialog={dialog}
        onConfirm={(understood, removeGallery) => {
          void confirm(understood, removeGallery);
        }}
        onCancel={cancel}
        testID={`${testID}-confirm`}
      />
    );
  }

  return null;
});
