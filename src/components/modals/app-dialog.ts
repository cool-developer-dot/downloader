import { create } from 'zustand';

/**
 * A question or notice shown in the app's own themed dialog (ConfirmModal, through `AppDialogHost`), asked from code
 * that has no screen of its own — the safety warnings. Pure state: safe to import from modules that Node tests load.
 */
export type AppDialogRequest = {
  title: string;
  message?: string;
  confirmLabel: string;
  /** Null for a notice with one button. */
  cancelLabel: string | null;
  /** `error`: the red, destructive look of a safety warning. */
  variant?: 'warning' | 'error';
};

type PendingDialog = AppDialogRequest & { id: number; resolve: (confirmed: boolean) => void };

type AppDialogState = { current: PendingDialog | null; hosts: number };

export const useAppDialogStore = create<AppDialogState>(() => ({ current: null, hosts: 0 }));

let nextId = 1;

/** Whether a host is mounted (it is, once the app's providers are): callers fall back to the system dialog without. */
export function hasAppDialogHost(): boolean {
  return useAppDialogStore.getState().hosts > 0;
}

/** Shows the dialog; resolves true for the confirm button, false for Cancel, Back or a newer dialog replacing it. */
export function showAppDialog(request: AppDialogRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = useAppDialogStore.getState().current;
    useAppDialogStore.setState({ current: { ...request, id: nextId++, resolve } });
    previous?.resolve(false);
  });
}

export function answerAppDialog(id: number, confirmed: boolean): void {
  const current = useAppDialogStore.getState().current;
  if (!current || current.id !== id) {
    return;
  }
  useAppDialogStore.setState({ current: null });
  current.resolve(confirmed);
}

export function registerAppDialogHost(): () => void {
  useAppDialogStore.setState((state) => ({ hosts: state.hosts + 1 }));
  return () => useAppDialogStore.setState((state) => ({ hosts: Math.max(0, state.hosts - 1) }));
}
