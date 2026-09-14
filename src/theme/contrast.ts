/**
 * Relative luminance / WCAG contrast helpers for theme token audits.
 * Not a certification claim — used for static high-risk pair reporting.
 */

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace('#', '');
  if (raw.length === 3) {
    const r = parseInt(raw[0]! + raw[0]!, 16);
    const g = parseInt(raw[1]! + raw[1]!, 16);
    const b = parseInt(raw[2]! + raw[2]!, 16);
    return { r, g, b };
  }
  if (raw.length === 6) {
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }
  return null;
}

function parseRgba(color: string): { r: number; g: number; b: number; a: number } | null {
  const m = color
    .trim()
    .match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!m) {
    return null;
  }
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

/** Composite foreground over opaque background when fg has alpha. */
function compositeOver(
  fg: { r: number; g: number; b: number; a: number },
  bg: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  const a = Math.min(1, Math.max(0, fg.a));
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
}

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string, behind = '#FFFFFF'): number | null {
  const hex = parseHex(color);
  if (hex) {
    return (
      0.2126 * channelToLinear(hex.r) +
      0.7152 * channelToLinear(hex.g) +
      0.0722 * channelToLinear(hex.b)
    );
  }
  const rgba = parseRgba(color);
  const bg = parseHex(behind) ?? parseRgba(behind);
  if (!rgba || !bg) {
    return null;
  }
  const opaqueBg = 'a' in bg ? { r: bg.r, g: bg.g, b: bg.b } : bg;
  const composed = compositeOver(rgba, opaqueBg);
  return (
    0.2126 * channelToLinear(composed.r) +
    0.7152 * channelToLinear(composed.g) +
    0.0722 * channelToLinear(composed.b)
  );
}

/** WCAG 2.x contrast ratio (1–21). Returns null if colors cannot be parsed. */
export function contrastRatio(
  foreground: string,
  background: string,
): number | null {
  const l1 = relativeLuminance(foreground, background);
  const l2 = relativeLuminance(background);
  if (l1 == null || l2 == null) {
    return null;
  }
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function roundContrast(ratio: number | null, digits = 2): number | null {
  if (ratio == null || Number.isNaN(ratio)) {
    return null;
  }
  const f = 10 ** digits;
  return Math.round(ratio * f) / f;
}
