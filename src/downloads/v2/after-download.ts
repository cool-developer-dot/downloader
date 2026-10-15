/**
 * Open After Download (#156) / Post-download Action (#361): what VidoraX does when a v2 download completes —
 * nothing (the default, today's behaviour), open its details, play it, or save it to the gallery.
 *
 * - Triggered by the engine's own `onDownloadStateChange` → `completed` events, each download at most once.
 * - Open and Play only while the app is in the foreground — never an activity from the background — and when
 *   several downloads finish together (within `SETTLE_MS`), only for the one that finished last.
 * - Save to Gallery runs for each completed download, unless the existing "Save to Gallery" setting is on: the
 *   engine already exports those, so the action never exports twice.
 *
 * Pure: everything that touches the app comes in through `AfterDownloadDeps`.
 */

export type AfterDownloadAction = 'none' | 'details' | 'play' | 'gallery';

export const AFTER_DOWNLOAD_ACTIONS: readonly AfterDownloadAction[] = ['none', 'details', 'play', 'gallery'];
export const DEFAULT_AFTER_DOWNLOAD_ACTION: AfterDownloadAction = 'none';
/** Completions this close together count as "finished at once". */
export const SETTLE_MS = 1_500;
/** Ids remembered so a repeated `completed` event never acts twice. */
const HANDLED_LIMIT = 200;

export function normalizeAfterDownloadAction(raw: unknown): AfterDownloadAction {
  return typeof raw === 'string' && (AFTER_DOWNLOAD_ACTIONS as readonly string[]).includes(raw)
    ? (raw as AfterDownloadAction)
    : DEFAULT_AFTER_DOWNLOAD_ACTION;
}

export type Completion = { id: string; completedAt: number };

/** Pure: the completion that finished last (ties: the one reported last). Null for none. */
export function mostRecentCompletion(completions: readonly Completion[]): Completion | null {
  let latest: Completion | null = null;
  for (const completion of completions) {
    if (!latest || completion.completedAt >= latest.completedAt) {
      latest = completion;
    }
  }
  return latest;
}

export type AfterDownloadPlan = { kind: 'details' | 'play' | 'gallery'; id: string };

/**
 * Pure: what to do for a batch of completions that settled together.
 */
export function planAfterDownload(input: {
  action: AfterDownloadAction;
  completions: readonly Completion[];
  foreground: boolean;
  autoSaveToGallery: boolean;
}): AfterDownloadPlan[] {
  const { action, completions } = input;
  if (action === 'none' || completions.length === 0) {
    return [];
  }
  if (action === 'gallery') {
    return input.autoSaveToGallery ? [] : completions.map((c) => ({ kind: 'gallery', id: c.id }));
  }
  if (!input.foreground) {
    return [];
  }
  const latest = mostRecentCompletion(completions);
  return latest ? [{ kind: action, id: latest.id }] : [];
}

export type AfterDownloadDeps = {
  getAction: () => AfterDownloadAction;
  isForeground: () => boolean;
  autoSaveToGallery: () => boolean;
  openDetails: (id: string) => void;
  play: (id: string) => void;
  saveToGallery: (id: string) => Promise<void> | void;
  schedule: (run: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
};

export type AfterDownloadController = {
  /** A record reached `completed`. */
  onCompleted: (completion: Completion) => void;
  dispose: () => void;
};

export function createAfterDownloadController(deps: AfterDownloadDeps): AfterDownloadController {
  const handled = new Set<string>();
  let pending: Completion[] = [];
  let timer: unknown = null;

  const remember = (id: string) => {
    handled.add(id);
    if (handled.size > HANDLED_LIMIT) {
      const oldest = handled.values().next().value;
      if (oldest !== undefined) {
        handled.delete(oldest);
      }
    }
  };

  const flush = () => {
    timer = null;
    const batch = pending;
    pending = [];
    let plans: AfterDownloadPlan[] = [];
    try {
      plans = planAfterDownload({
        action: normalizeAfterDownloadAction(deps.getAction()),
        completions: batch,
        foreground: deps.isForeground(),
        autoSaveToGallery: deps.autoSaveToGallery(),
      });
    } catch {
      plans = [];
    }
    for (const plan of plans) {
      try {
        if (plan.kind === 'details') {
          deps.openDetails(plan.id);
        } else if (plan.kind === 'play') {
          deps.play(plan.id);
        } else {
          void Promise.resolve(deps.saveToGallery(plan.id)).catch(() => {
            // A failed export never affects the download; the item's own "Save to gallery" stays available.
          });
        }
      } catch {
        // An action must never disturb downloads.
      }
    }
  };

  return {
    onCompleted: (completion) => {
      if (!completion.id || handled.has(completion.id)) {
        return;
      }
      remember(completion.id);
      // Nothing to do at all: never hold a timer for the default.
      if (normalizeAfterDownloadAction(deps.getAction()) === 'none') {
        return;
      }
      pending.push(completion);
      if (timer != null) {
        deps.cancel(timer);
      }
      timer = deps.schedule(flush, SETTLE_MS);
    },
    dispose: () => {
      if (timer != null) {
        deps.cancel(timer);
      }
      timer = null;
      pending = [];
    },
  };
}
