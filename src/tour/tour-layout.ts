/**
 * Geometry of the tour: the spotlight around a measured target and where the step card goes. Pure, unit tested.
 * All rects are in window coordinates (`measureInWindow`), the same space the full-window overlay draws in.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

/** Breathing room between the highlighted element and the spotlight's edge. */
export const SPOTLIGHT_PADDING = 6;
export const CARD_SCREEN_MARGIN = 16;
/** Space between the spotlight and the card (room for the card's pointer). */
export const CARD_GAP = 14;
export const CARD_MAX_WIDTH = 440;
/** Below this, neither side of the target has room for a readable card: it overlaps the target instead. */
export const MIN_CARD_SPACE = 170;
const CARET_EDGE_INSET = 28;

/** A measurement the tour can point at: real size, finite numbers, and at least partly on screen. */
export function isUsableRect(rect: Rect | null | undefined, screen: Size): rect is Rect {
  if (!rect) {
    return false;
  }
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isFinite)) {
    return false;
  }
  if (width < 4 || height < 4) {
    return false;
  }
  return x < screen.width && y < screen.height && x + width > 0 && y + height > 0;
}

/** The target grown by [padding] and clipped to the screen. */
export function spotlightRect(target: Rect, screen: Size, padding: number = SPOTLIGHT_PADDING): Rect {
  const left = Math.max(0, target.x - padding);
  const top = Math.max(0, target.y - padding);
  const right = Math.min(screen.width, target.x + target.width + padding);
  const bottom = Math.min(screen.height, target.y + target.height + padding);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Where the "Video available" bar appears: the bottom strip of the Browser's page area, just above the toolbar
 * (`BrowserMediaDownloadBar` is anchored there).
 */
export function videoBarRect(pageArea: Rect, barHeight: number): Rect {
  const height = Math.min(barHeight, pageArea.height);
  return { x: pageArea.x, y: pageArea.y + pageArea.height - height, width: pageArea.width, height };
}

export type CardPlacement = {
  side: 'above' | 'below' | 'overlay';
  left: number;
  width: number;
  /** Distance from the top of the screen (below / overlay at top) … */
  top: number | null;
  /** … or from the bottom (above / overlay at bottom). */
  bottom: number | null;
  /** The card scrolls inside this height, so a large font scale never clips it. */
  maxHeight: number;
  /** Horizontal position of the pointer toward the target, relative to the card's left edge; null = no pointer. */
  caretX: number | null;
};

export type SafeInsets = { top: number; bottom: number };

export function placeCard(spot: Rect, screen: Size, insets: SafeInsets): CardPlacement {
  const width = Math.max(0, Math.min(screen.width - 2 * CARD_SCREEN_MARGIN, CARD_MAX_WIDTH));
  const left = Math.round((screen.width - width) / 2);
  const minTop = insets.top + CARD_SCREEN_MARGIN;
  const maxBottom = screen.height - insets.bottom - CARD_SCREEN_MARGIN;

  const spaceAbove = spot.y - CARD_GAP - minTop;
  const spaceBelow = maxBottom - (spot.y + spot.height + CARD_GAP);
  const caret = () => {
    const center = spot.x + spot.width / 2 - left;
    return Math.round(Math.min(Math.max(center, CARET_EDGE_INSET), width - CARET_EDGE_INSET));
  };

  if (Math.max(spaceAbove, spaceBelow) >= MIN_CARD_SPACE) {
    if (spaceBelow >= spaceAbove) {
      return {
        side: 'below',
        left,
        width,
        top: Math.round(spot.y + spot.height + CARD_GAP),
        bottom: null,
        maxHeight: Math.floor(spaceBelow),
        caretX: caret(),
      };
    }
    return {
      side: 'above',
      left,
      width,
      top: null,
      bottom: Math.round(screen.height - (spot.y - CARD_GAP)),
      maxHeight: Math.floor(spaceAbove),
      caretX: caret(),
    };
  }

  // A target that fills most of the screen: the card sits over the half of the screen with less of the target.
  const targetCenter = spot.y + spot.height / 2;
  const maxHeight = Math.max(0, Math.floor(Math.min(maxBottom - minTop, screen.height * 0.6)));
  if (targetCenter >= screen.height / 2) {
    return { side: 'overlay', left, width, top: Math.round(minTop), bottom: null, maxHeight, caretX: null };
  }
  return {
    side: 'overlay',
    left,
    width,
    top: null,
    bottom: Math.round(screen.height - maxBottom),
    maxHeight,
    caretX: null,
  };
}

/** SVG path of a full-screen dim with a rounded-rect hole (even-odd fill). */
export function spotlightPath(screen: Size, hole: Rect, radius: number): string {
  'worklet';
  const r = Math.max(0, Math.min(radius, hole.width / 2, hole.height / 2));
  const x = hole.x;
  const y = hole.y;
  const w = hole.width;
  const h = hole.height;
  const outer = `M0 0H${screen.width}V${screen.height}H0Z`;
  if (w <= 0 || h <= 0) {
    return outer;
  }
  const inner =
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  return outer + inner;
}
