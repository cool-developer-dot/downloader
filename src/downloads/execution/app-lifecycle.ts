import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

export type DownloadAppLifecyclePhase = 'active' | 'inactive' | 'background';

export type DownloadAppLifecycleListener = (event: {
  phase: DownloadAppLifecyclePhase;
  previous: DownloadAppLifecyclePhase;
  /** True when returning to interactive foreground from inactive/background. */
  becameActive: boolean;
  /** True when leaving interactive foreground (not transient-only if background). */
  leftForeground: boolean;
}) => void;

function normalizePhase(status: AppStateStatus): DownloadAppLifecyclePhase {
  if (status === 'active') {
    return 'active';
  }
  if (status === 'background') {
    return 'background';
  }
  return 'inactive';
}

/**
 * Single downloads-domain AppState coordinator.
 * Engine / recovery / FGS subscribe here — screens must not add their own.
 */
class DownloadAppLifecycleCoordinator {
  private attached = false;
  private subscription: NativeEventSubscription | null = null;
  private phase: DownloadAppLifecyclePhase = normalizePhase(AppState.currentState);
  private readonly listeners = new Set<DownloadAppLifecycleListener>();

  getPhase(): DownloadAppLifecyclePhase {
    return this.phase;
  }

  subscribe(listener: DownloadAppLifecycleListener): () => void {
    this.listeners.add(listener);
    this.ensureAttached();
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Idempotent attach used by bootstrap. */
  ensureAttached(): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.phase = normalizePhase(AppState.currentState);
    this.subscription = AppState.addEventListener('change', (next) => {
      this.handleChange(next);
    });
  }

  /** Test helper. */
  emitForTests(next: AppStateStatus): void {
    this.handleChange(next);
  }

  disposeForTests(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.attached = false;
    this.listeners.clear();
    this.phase = 'active';
  }

  private handleChange(next: AppStateStatus): void {
    const previous = this.phase;
    const phase = normalizePhase(next);
    this.phase = phase;

    const becameActive =
      previous !== 'active' && phase === 'active';
    // Do not thrash FGS on inactive alone — service follows transfer count.
    const leftForeground =
      previous === 'active' && phase !== 'active';

    for (const listener of this.listeners) {
      try {
        listener({ phase, previous, becameActive, leftForeground });
      } catch {
        // never break lifecycle bus
      }
    }
  }
}

export const downloadAppLifecycle = new DownloadAppLifecycleCoordinator();
