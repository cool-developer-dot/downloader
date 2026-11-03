/**
 * B20 #210 Export data — bookmarks as the Netscape bookmark file Chrome, Firefox and Edge export and import. Pure.
 * The bookmarks go in one folder named for the profile, so an import elsewhere keeps them together. B9 (folders,
 * import) builds on this serializer.
 */

export type NetscapeBookmark = { url: string; title: string; createdAt: string };

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Seconds since 1970 (the format's ADD_DATE); 0 when the date is unreadable. */
function addDate(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function netscapeBookmarksHtml(folderName: string, bookmarks: readonly NetscapeBookmark[], now: Date): string {
  const created = Math.floor(now.getTime() / 1000);
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `    <DT><H3 ADD_DATE="${created}" LAST_MODIFIED="${created}">${escapeHtml(folderName)}</H3>`,
    '    <DL><p>',
  ];
  for (const bookmark of bookmarks) {
    if (!isWebUrl(bookmark.url)) continue;
    const title = bookmark.title.trim() || bookmark.url;
    lines.push(
      `        <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${addDate(bookmark.createdAt)}">${escapeHtml(title)}</A>`,
    );
  }
  lines.push('    </DL><p>', '</DL><p>', '');
  return lines.join('\n');
}
