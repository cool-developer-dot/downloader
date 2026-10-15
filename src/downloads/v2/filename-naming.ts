/**
 * Where the handoff gets the user's filename template from. The settings store registers itself at startup
 * (`ensureFilenameNaming`); until something registers — and in tests — the title is left exactly as it is.
 */

import type { EnqueueRequest } from '@modules/vidorax-media/src/VidoraMedia.types';

import { applyFilenameTemplate } from './filename-template';

type TemplateSource = () => string | null | undefined;

let templateSource: TemplateSource | null = null;

export function setFilenameTemplateSource(source: TemplateSource | null): void {
  templateSource = source;
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
