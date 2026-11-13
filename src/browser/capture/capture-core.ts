/**
 * B17 — the pure rules of capture, offline pages, PDFs and image download (tested under Node).
 */

/** What B9's reading list stores as a page's offline copy: our saved page, opened in the read-only viewer. */
const OFFLINE_MARKER = 'vidorax://offline/';

export function offlineMarker(savedPageId: string): string {
  return `${OFFLINE_MARKER}${savedPageId}`;
}

/** The saved page id in a reading-list offline URI, or null for anything else. */
export function savedPageIdOf(uri: string | null | undefined): string | null {
  if (!uri || !uri.startsWith(OFFLINE_MARKER)) return null;
  const id = uri.slice(OFFLINE_MARKER.length);
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** The profile key VidoraWeb accepts for a profile's folder (letters, digits, _ and -; at most 64). */
export function offlineProfileKey(profileId: string): string {
  const key = profileId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return key || 'default';
}

export const PDF_CHOICES = ['ask', 'viewer', 'download', 'external'] as const;
export type PdfChoice = (typeof PDF_CHOICES)[number];

export function isPdfChoice(value: unknown): value is PdfChoice {
  return typeof value === 'string' && (PDF_CHOICES as readonly string[]).includes(value);
}

/** The notice key for a failed PDF fetch / open. */
export function pdfFailureKey(status: string):
  | 'browserCapture.pdfNotPdf'
  | 'browserCapture.pdfTooLarge'
  | 'browserCapture.pdfProtected'
  | 'browserCapture.pdfFailed' {
  if (status === 'notPdf') return 'browserCapture.pdfNotPdf';
  if (status === 'tooLarge') return 'browserCapture.pdfTooLarge';
  if (status === 'protected') return 'browserCapture.pdfProtected';
  return 'browserCapture.pdfFailed';
}

/** An image address that can be downloaded: http(s) only (data: and blob: pictures can't go to the downloader). */
export function downloadableImageSrc(src: unknown): string | null {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (trimmed.length > 8192 || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

/** "1.2 MB" / "640 KB" for a saved page. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const PDF_ZOOMS = [1, 1.5, 2, 3] as const;

/** The next zoom step up or down (clamped). */
export function stepZoom(current: number, direction: 1 | -1): number {
  const index = PDF_ZOOMS.findIndex((z) => z >= current);
  const at = index < 0 ? PDF_ZOOMS.length - 1 : index;
  return PDF_ZOOMS[Math.max(0, Math.min(PDF_ZOOMS.length - 1, at + direction))];
}

/** A page's height in the list for its point size drawn `width` wide (fixed layout for 50+ pages). */
export function pageHeight(page: readonly [number, number], width: number): number {
  const [w, h] = page;
  return w > 0 && h > 0 ? Math.round((width * h) / w) : width;
}
