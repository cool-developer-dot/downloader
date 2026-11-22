import { memo, useEffect } from 'react';

import { answerAppDialog, registerAppDialogHost, useAppDialogStore } from './app-dialog';
import { ConfirmModal } from './ConfirmModal';

/** Renders `showAppDialog` requests in the app's themed dialog. Mounted once, inside the app's providers. */
export const AppDialogHost = memo(function AppDialogHost() {
  const current = useAppDialogStore((state) => state.current);
  useEffect(() => registerAppDialogHost(), []);
  return (
    <ConfirmModal
      visible={current != null}
      variant={current?.variant ?? 'warning'}
      title={current?.title ?? ''}
      message={current?.message}
      confirmLabel={current?.confirmLabel}
      cancelLabel={current?.cancelLabel ?? undefined}
      hideCancel={current != null && current.cancelLabel == null}
      onConfirm={() => current && answerAppDialog(current.id, true)}
      onCancel={() => current && answerAppDialog(current.id, false)}
      testID="app-dialog"
    />
  );
});
