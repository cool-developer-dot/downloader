/**
 * Saving a text file (JSON, CSV, a log) where the user chooses, and reading one back — the logic, with the
 * platform calls injected so it runs under Node tests. `text-file-export.ts` binds the real ones.
 *
 * Save: the system folder picker (Storage Access Framework — no storage permission), then the file is created
 * there. When the picker is not available or writing fails, the text goes to the system share sheet instead.
 * A user who cancels the picker is never shown the share sheet.
 */

export type TextExportResult = 'saved' | 'shared' | 'cancelled' | 'failed';

export type TextExportInput = {
  fileName: string;
  mimeType: string;
  content: string;
  /** Title of the share sheet when it is used. */
  shareTitle: string;
};

export type TextExportDeps = {
  /** Resolves with a handle to write into, or rejects (a cancel is recognised by `isCancelError`). */
  pickDirectory: () => Promise<unknown>;
  writeFile: (directory: unknown, fileName: string, mimeType: string, content: string) => void | Promise<void>;
  /** Resolves true when shared, false when the user dismissed the sheet. */
  share: (content: string, title: string) => Promise<boolean>;
};

/** The share sheet carries the text itself; beyond this it is refused rather than crashing the intent. */
export const MAX_SHARE_CHARS = 200_000;
/** A file to import larger than this is refused unread. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export function isCancelError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = (error as { message?: unknown } | null)?.message;
  return (
    (typeof code === 'string' && /cancel/i.test(code)) || (typeof message === 'string' && /cancel/i.test(message))
  );
}

export async function exportTextFileWith(deps: TextExportDeps, input: TextExportInput): Promise<TextExportResult> {
  let directory: unknown = null;
  try {
    directory = await deps.pickDirectory();
  } catch (error) {
    if (isCancelError(error)) {
      return 'cancelled';
    }
    directory = null;
  }
  if (directory != null) {
    try {
      await deps.writeFile(directory, input.fileName, input.mimeType, input.content);
      return 'saved';
    } catch {
      // Fall back to sharing the text.
    }
  }
  if (input.content.length > MAX_SHARE_CHARS) {
    return 'failed';
  }
  try {
    return (await deps.share(input.content, input.shareTitle)) ? 'shared' : 'cancelled';
  } catch {
    return 'failed';
  }
}

/** `vidorax-<what>-YYYY-MM-DD.<ext>` in local time. */
export function exportFileName(what: string, extension: string, now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = Number.isFinite(now.getTime())
    ? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    : 'export';
  const safeWhat = what.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'export';
  return `vidorax-${safeWhat}-${date}.${extension}`;
}

export type TextImportResult =
  | { status: 'picked'; text: string }
  | { status: 'cancelled' }
  | { status: 'too-large' }
  | { status: 'failed' };

export type TextImportDeps = {
  /** Null when the user cancelled. */
  pickFile: () => Promise<{ size: number | null; read: () => Promise<string> } | null>;
};

export async function importTextFileWith(deps: TextImportDeps): Promise<TextImportResult> {
  try {
    const picked = await deps.pickFile();
    if (!picked) {
      return { status: 'cancelled' };
    }
    if (typeof picked.size === 'number' && picked.size > MAX_IMPORT_BYTES) {
      return { status: 'too-large' };
    }
    const text = await picked.read();
    if (text.length > MAX_IMPORT_BYTES) {
      return { status: 'too-large' };
    }
    return { status: 'picked', text };
  } catch (error) {
    return isCancelError(error) ? { status: 'cancelled' } : { status: 'failed' };
  }
}
