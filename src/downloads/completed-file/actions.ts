/**
 * Phase 7A — completed-file action capabilities.
 *
 * 7A establishes capability routing only:
 * - Play may use the existing VidoraX player when the file is present.
 * - Open / Share / Export are capability flags for 7B/7C handoff.
 *   Production Library UI must not expose them as dead buttons.
 * - Delete may surface where an existing safe remove path already exists.
 */

import { classifyLibraryDownloadState } from './state';
import type { CompletedFileActions } from './types';

export type ResolveCompletedActionsInput = {
  status: string | null | undefined;
  workerState?: string | null;
  /** Physical canonical file exists and is usable. */
  physicalFilePresent: boolean;
  /**
   * When true, Open/Share are available (Phase 7B Android content URI handoff).
   * Library and Downloads should pass true on Android production surfaces.
   */
  allowExternalHandoff?: boolean;
  /** Existing delete/remove path is wired for this surface. */
  allowDelete?: boolean;
  /** Export/Save is Phase 7C — keep false in 7A production surfaces. */
  allowExport?: boolean;
};

export function resolveCompletedActions(
  input: ResolveCompletedActionsInput,
): CompletedFileActions {
  const group = classifyLibraryDownloadState(input.status, input.workerState);
  const isCompleted = group === 'completed';
  const present = isCompleted && input.physicalFilePresent === true;

  return {
    canPlay: present,
    canOpen: present && input.allowExternalHandoff === true,
    canShare: present && input.allowExternalHandoff === true,
    canDelete: isCompleted && input.allowDelete === true,
    canExport: present && input.allowExport === true,
  };
}
