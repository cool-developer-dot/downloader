/**
 * B23 #279 — Draw on page: strokes, the eraser (removes the strokes it touches), undo and redo. Pure; tested under
 * Node. Points are in the picture's pixels; the screen scales them.
 */

export const PEN_COLORS = ['#E53935', '#1E88E5', '#43A047', '#FDD835', '#212121', '#FFFFFF'] as const;
export const PEN_SIZES = [4, 8, 16] as const;

export type Stroke = { id: number; color: string; width: number; points: number[] };

type Op = { type: 'add'; stroke: Stroke } | { type: 'erase'; strokes: Stroke[] };

export type DrawState = { strokes: Stroke[]; undo: Op[]; redo: Op[]; nextId: number };

export const EMPTY_DRAWING: DrawState = { strokes: [], undo: [], redo: [], nextId: 1 };

export function addStroke(state: DrawState, color: string, width: number, points: readonly number[]): DrawState {
  if (points.length < 2) return state;
  const stroke: Stroke = { id: state.nextId, color, width, points: [...points] };
  return { strokes: [...state.strokes, stroke], undo: [...state.undo, { type: 'add', stroke }], redo: [], nextId: state.nextId + 1 };
}

/** Distance from point p to the segment a–b. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const p = stroke.points;
  const reach = radius + stroke.width / 2;
  if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= reach;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (segmentDistance(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
  }
  return false;
}

/** The eraser at (x, y): removes every stroke it touches (one undo step per touch that removed something). */
export function eraseAt(state: DrawState, x: number, y: number, radius: number): DrawState {
  const hit = state.strokes.filter((s) => strokeHit(s, x, y, radius));
  if (!hit.length) return state;
  const ids = new Set(hit.map((s) => s.id));
  return { ...state, strokes: state.strokes.filter((s) => !ids.has(s.id)), undo: [...state.undo, { type: 'erase', strokes: hit }], redo: [] };
}

export function undo(state: DrawState): DrawState {
  const op = state.undo[state.undo.length - 1];
  if (!op) return state;
  const strokes =
    op.type === 'add'
      ? state.strokes.filter((s) => s.id !== op.stroke.id)
      : [...state.strokes, ...op.strokes].sort((a, b) => a.id - b.id);
  return { ...state, strokes, undo: state.undo.slice(0, -1), redo: [...state.redo, op] };
}

export function redo(state: DrawState): DrawState {
  const op = state.redo[state.redo.length - 1];
  if (!op) return state;
  const ids = op.type === 'erase' ? new Set(op.strokes.map((s) => s.id)) : null;
  const strokes = op.type === 'add' ? [...state.strokes, op.stroke] : state.strokes.filter((s) => !ids!.has(s.id));
  return { ...state, strokes, undo: [...state.undo, op], redo: state.redo.slice(0, -1) };
}

/** An SVG path for a stroke ('M x y L …'), in picture pixels. */
export function strokePath(points: readonly number[]): string {
  if (points.length < 2) return '';
  let d = `M${points[0].toFixed(1)} ${points[1].toFixed(1)}`;
  if (points.length === 2) return `${d} L${(points[0] + 0.1).toFixed(1)} ${points[1].toFixed(1)}`;
  for (let i = 2; i + 1 < points.length; i += 2) d += ` L${points[i].toFixed(1)} ${points[i + 1].toFixed(1)}`;
  return d;
}

/** What VidoraWeb.exportDrawing draws. */
export function strokesJson(state: DrawState): string {
  return JSON.stringify(state.strokes.map((s) => ({ color: s.color, width: s.width, points: s.points.map((v) => Math.round(v * 10) / 10) })));
}
