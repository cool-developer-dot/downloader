/**
 * The file name when the page in front is itself a file (`…/sample.wav`, `…/clip.ogv?x=1`), not a web page; else null.
 * Pure. Used to offer "Download file" when VidoraX can't keep that file as a video.
 */
const PAGE_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'php', 'asp', 'aspx', 'jsp', 'cgi', 'shtml']);

export function pageFileName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const last = decodeURIComponent(parsed.pathname.split('/').pop() ?? '');
    const dot = last.lastIndexOf('.');
    if (dot <= 0) return null;
    const ext = last.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,5}$/.test(ext) && !PAGE_EXTENSIONS.has(ext) ? last : null;
  } catch {
    return null;
  }
}
