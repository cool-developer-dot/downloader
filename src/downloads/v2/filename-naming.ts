/**
 * Where the handoff gets the user's filename template from. The settings store registers itself at startup
 * (`ensureFilenameNaming`); until something registers — and in tests — the title is left exactly as it is.
 */

import type { EnqueueRequest } from '@modules/vidorax-media/src/VidoraMedia.types';

import { preferredExtensionForEngine } from './file-extension';
import { applyFilenameTemplate } from './filename-template';

type TemplateSource = () => string | null | undefined;

let templateSource: TemplateSource | null = null;
let extensionSource: (() => unknown) | null = null;

export function setFilenameTemplateSource(source: TemplateSource | null): void {
  templateSource = source;
}

/** Custom Extension (#494): where the handoff reads the "File extension" choice from. */
export function setFileExtensionSource(source: (() => unknown) | null): void {
  extensionSource = source;
}

/** The extension to ask the engine for, or undefined (Automatic, nothing registered, or a failing source). */
export function preferredExtensionFor(): 'mp4' | 'm4v' | undefined {
  try {
    return preferredExtensionForEngine(extensionSource?.());
  } catch {
    return undefined;
  }
}

/** The title to give the engine for this request: the template applied, or the request's own title. */
export function namedTitleFor(request: Pick<EnqueueRequest, 'title' | 'pageUrl' | 'site' | 'qualityLabel'>, now = new Date()): string {
  let template: string | null | undefined = null;
  try {
    template = templateSource?.() ?? null;
  } catch {
    template = null;
  }
  try {
    return applyFilenameTemplate({
      template,
      title: request.title,
      pageUrl: request.pageUrl ?? null,
      site: request.site,
      qualityLabel: request.qualityLabel ?? null,
      now,
    });
  } catch {
    // Naming must never stop a download.
    return request.title;
  }
}
