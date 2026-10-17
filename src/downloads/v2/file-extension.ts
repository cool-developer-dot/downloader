/**
 * Custom Extension (#494): Download Settings → File naming → "File extension". Automatic (the default) sends nothing,
 * so naming is exactly as before. `.mp4` / `.m4v` are sent as `EnqueueRequest.preferredExtension`; the engine uses
 * the value only when it is a safe alias for the container the file's bytes prove (an MP4 video: mp4 or m4v; an
 * audio-only MP4: m4a or mp4) and keeps the usual extension for anything else (WebM, TS, MOV…). Pure.
 */

export const FILE_EXTENSION_CHOICES = ['auto', 'mp4', 'm4v'] as const;
export type FileExtensionChoice = (typeof FILE_EXTENSION_CHOICES)[number];
export const DEFAULT_FILE_EXTENSION: FileExtensionChoice = 'auto';

/** A stored or imported value as the settings keep it; anything unknown is Automatic. */
export function normalizeFileExtensionChoice(raw: unknown): FileExtensionChoice {
  if (typeof raw !== 'string') {
    return DEFAULT_FILE_EXTENSION;
  }
  const value = raw.trim().replace(/^\./, '').toLowerCase();
  return (FILE_EXTENSION_CHOICES as readonly string[]).includes(value) ? (value as FileExtensionChoice) : DEFAULT_FILE_EXTENSION;
}

/** What the enqueue request carries: nothing for Automatic. */
export function preferredExtensionForEngine(choice: unknown): 'mp4' | 'm4v' | undefined {
  const normalized = normalizeFileExtensionChoice(choice);
  return normalized === 'auto' ? undefined : normalized;
}
