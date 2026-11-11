import { createStore } from '@/store/shared/create-store';

import {
  armDuplicateBypass,
  disarmDuplicateBypass,
  duplicateKey,
  uniqueCopyTitle,
  type DuplicateAction,
} from './duplicate-action';
import { getDuplicateAction } from './duplicate-action-store';
import { trackReplacement } from './duplicate-replacements';
import { buildV2EnqueueRequest, type V2HandoffInput } from './enqueue-request';
import { getV2Engine } from './engine-port';

/**
 * H12 (#386): turns "Already downloaded" into what the user chose in Download Settings. Skip keeps today's answer;
 * Keep both and Replace download the video again through the caller's own path ([rerun]) with the duplicate checks
 * off for that one request; Ask keeps today's answer and offers the choice (see `DuplicatePromptDialog`).
 */

export type DuplicateChoice = Exclude<DuplicateAction, 'ask'>;

/** What a download attempt answered, as far as this needs to know. */
export type DuplicateRerunResult = { ok: boolean; downloadId?: string | null; deduped?: boolean; message?: string };

/** The saved copy the engine found: its library item (null when only VidoraX's gallery copy is left). */
export type ExistingCopy = { downloadId: string | null };

export type DuplicatePrompt = {
  title: string;
  /** Runs the choice; resolves with the new download's answer (null for Skip or when nothing started). */
  choose: (choice: DuplicateChoice) => Promise<DuplicateRerunResult | null>;
};

export const useDuplicatePromptStore = createStore<{ prompt: DuplicatePrompt | null }>()(() => ({ prompt: null }));

export type DuplicateChoiceDeps = {
  action: () => DuplicateAction;
  /** Titles of saved videos like [title], for the "(2)" of Keep both. */
  existingTitles: (title: string) => Promise<string[]>;
  trackReplacement: (newId: string, oldId: string) => void;
  prompt: (prompt: DuplicatePrompt) => void;
};

async function libraryTitlesLike(title: string): Promise<string[]> {
  const engine = getV2Engine();
  if (!engine) {
    return [];
  }
  try {
    const base = title.replace(/ \(\d{1,4}\)$/, '').trim();
    const page = await engine.listLibrary({ search: base, limit: 200 });
    return page.items.map((item) => item.title);
  } catch {
    return [];
  }
}

const defaultDeps: DuplicateChoiceDeps = {
  action: getDuplicateAction,
  existingTitles: libraryTitlesLike,
  trackReplacement,
  prompt: (prompt) => useDuplicatePromptStore.setState({ prompt }),
};

/** Videos being downloaded again right now: a second tap on the same choice does nothing. */
const running = new Set<string>();

async function runChoice<T extends DuplicateRerunResult>(
  choice: DuplicateChoice,
  existing: ExistingCopy,
  input: V2HandoffInput,
  rerun: () => Promise<T>,
  deps: DuplicateChoiceDeps,
): Promise<T | null> {
  if (choice === 'skip') {
    return null;
  }
  const decision = buildV2EnqueueRequest(input);
  if (!decision.ok) {
    return null;
  }
  const key = duplicateKey(decision.request);
  if (running.has(key)) {
    return null;
  }
  running.add(key);
  try {
    const title =
      choice === 'keep_both'
        ? uniqueCopyTitle(decision.request.title, await deps.existingTitles(decision.request.title))
        : null;
    armDuplicateBypass(key, { title });
    const result = await rerun();
    const newId = result.ok && !result.deduped ? result.downloadId ?? null : null;
    if (choice === 'replace' && newId && existing.downloadId && newId !== existing.downloadId) {
      // The old item goes only once the new one completed; a failed or cancelled new one leaves it alone.
      deps.trackReplacement(newId, existing.downloadId);
    }
    return result;
  } finally {
    disarmDuplicateBypass(key);
    running.delete(key);
  }
}

/**
 * Called where a download attempt found that the user already has the video. Null keeps today's answer ("Video
 * already downloaded"); otherwise the answer of the new download.
 */
export async function resolveDuplicateChoice<T extends DuplicateRerunResult>(
  existing: ExistingCopy,
  input: V2HandoffInput,
  rerun: () => Promise<T>,
  deps: DuplicateChoiceDeps = defaultDeps,
): Promise<T | null> {
  const action = deps.action();
  if (action === 'skip') {
    return null;
  }
  if (action === 'ask') {
    deps.prompt({
      title: input.title,
      choose: (choice) => runChoice(choice, existing, input, rerun, deps),
    });
    return null;
  }
  return runChoice(action, existing, input, rerun, deps);
}

export function resetDuplicateChoiceForTests(): void {
  running.clear();
  useDuplicatePromptStore.setState({ prompt: null });
}
