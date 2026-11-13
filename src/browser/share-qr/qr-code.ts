import qrcode from 'qrcode-generator';

/**
 * B22 #249 / #30 — QR codes, pure (tested under Node).
 *
 * - `qrRows(text)`: the QR module matrix (rows of '1' dark / '0' light) for a page address, UTF-8, error correction M,
 *   drawn with react-native-svg and turned into a PNG natively. Null when it doesn't fit (over 1,800 characters).
 * - `classifyScan(text)`: what a scanned code is. An http(s) address asks "Open <host>?" first; any other address
 *   (`javascript:`, `intent:`, `file:`, `data:`, app links…) is shown as text only; anything else is text the user can
 *   search for or copy.
 */
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

export const QR_MAX_LENGTH = 1800;

export function qrRows(text: string): string[] | null {
  const value = text.trim();
  if (!value || value.length > QR_MAX_LENGTH) return null;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const rows: string[] = [];
    for (let r = 0; r < n; r += 1) {
      let row = '';
      for (let c = 0; c < n; c += 1) row += qr.isDark(r, c) ? '1' : '0';
      rows.push(row);
    }
    return rows;
  } catch {
    return null;
  }
}

/** An SVG path of the dark modules (one run per row segment), for a viewBox of `size + 8` with a 4-module margin. */
export function qrPath(rows: readonly string[]): string {
  let d = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '1') {
        x += 1;
        continue;
      }
      let end = x;
      while (end < row.length && row[end] === '1') end += 1;
      d += `M${x + 4} ${y + 4}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  return d;
}

export type ScanResult =
  | { kind: 'url'; url: string; host: string }
  | { kind: 'unsafe'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'empty' };

const SCHEME = /^([a-z][a-z0-9+.-]*):(\S*)$/i;

export function classifyScan(raw: string | null | undefined): ScanResult {
  const text = (raw ?? '').trim();
  if (!text) return { kind: 'empty' };
  const match = SCHEME.exec(text);
  const scheme = match?.[1]?.toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    try {
      const url = new URL(text);
      if (url.hostname) return { kind: 'url', url: url.toString(), host: url.hostname };
    } catch {
      // Not a valid address: text.
    }
    return { kind: 'text', text };
  }
  // Any other address (javascript:, intent:, file:, data:, content:, an app's own scheme…) is never opened. "word:"
  // followed by text with spaces is ordinary text (e.g. "Note: call me").
  if (scheme && match && !/^\d+$/.test(match[2] ?? '')) return { kind: 'unsafe', text };
  return { kind: 'text', text };
}
