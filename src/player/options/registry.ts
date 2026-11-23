/**
 * The Player's options sheet (the ⋮ menu): five fixed sections, filled by the packages that own the features.
 *
 * Each package adds its rows with ONE call — `register('<package>', [rows])` — from its own file, and never edits
 * another package's rows: a row id that another owner already registered is refused. Registering again under the
 * same owner replaces that owner's rows (a module re-run by Fast Refresh, a package that rebuilds its list).
 *
 * The sheet shows the sections in this fixed order, each with its visible rows sorted by `order` (ties keep the
 * order they were registered in); a section with nothing to show is left out. Pure: no React, no native code.
 */

export const PLAYER_OPTION_SECTIONS = ['playback', 'video', 'audio', 'subtitles', 'tools'] as const;

export type PlayerOptionSection = (typeof PLAYER_OPTION_SECTIONS)[number];

export type PlayerOptionRow<Ctx, Label extends string = string, Icon extends string = string> = {
  /** Unique across all packages; by convention `<package>.<name>`, e.g. `p1.stop`. */
  id: string;
  section: PlayerOptionSection;
  /** Position inside the section, lowest first. Leave gaps (10, 20, 30…) so others can slot in between. */
  order: number;
  /** The row's title (a string-catalog key, resolved by the sheet). */
  label: Label;
  icon: Icon;
  /** The current value shown at the row's end (10 seconds, Auto, 1.0×); null for none. */
  value?: (ctx: Ctx) => string | null;
  /** Hidden when false (a row for some videos only). Default: shown. */
  visible?: (ctx: Ctx) => boolean;
  /** Greyed and not pressable when false (the video is not ready). Default: enabled. */
  enabled?: (ctx: Ctx) => boolean;
  /** Runs after the sheet has closed. */
  onPress: (ctx: Ctx) => void;
};

export type PlayerOptionsSectionView<Ctx, Label extends string, Icon extends string> = {
  section: PlayerOptionSection;
  rows: { row: PlayerOptionRow<Ctx, Label, Icon>; enabled: boolean; value: string | null }[];
};

export type PlayerOptionsRegistry<Ctx, Label extends string = string, Icon extends string = string> = {
  /** Adds (or, for the same owner, replaces) one package's rows. Returns a function that removes them again. */
  register: (owner: string, rows: readonly PlayerOptionRow<Ctx, Label, Icon>[]) => () => void;
  /** What the sheet shows for this context: non-empty sections in the fixed order, rows sorted. */
  sections: (ctx: Ctx) => PlayerOptionsSectionView<Ctx, Label, Icon>[];
  /** Every registered row with its owner, in section and row order (for checks and tests). */
  all: () => { owner: string; row: PlayerOptionRow<Ctx, Label, Icon> }[];
};

export class PlayerOptionsRegistryError extends Error {}

export function createPlayerOptionsRegistry<
  Ctx,
  Label extends string = string,
  Icon extends string = string,
>(): PlayerOptionsRegistry<Ctx, Label, Icon> {
  type Row = PlayerOptionRow<Ctx, Label, Icon>;
  type Entry = { owner: string; row: Row; seq: number };

  const byOwner = new Map<string, Entry[]>();
  let seq = 0;

  const entries = (): Entry[] => {
    const list = [...byOwner.values()].flat();
    return list.sort(
      (a, b) =>
        PLAYER_OPTION_SECTIONS.indexOf(a.row.section) - PLAYER_OPTION_SECTIONS.indexOf(b.row.section) ||
        a.row.order - b.row.order ||
        a.seq - b.seq,
    );
  };

  const register = (owner: string, rows: readonly Row[]): (() => void) => {
    if (!owner.trim()) {
      throw new PlayerOptionsRegistryError('A player option owner needs a name.');
    }
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row.id.trim()) {
        throw new PlayerOptionsRegistryError(`${owner}: a row has no id.`);
      }
      if (ids.has(row.id)) {
        throw new PlayerOptionsRegistryError(`${owner}: row "${row.id}" is listed twice.`);
      }
      ids.add(row.id);
      if (!(PLAYER_OPTION_SECTIONS as readonly string[]).includes(row.section)) {
        throw new PlayerOptionsRegistryError(`${owner}: row "${row.id}" names an unknown section "${row.section}".`);
      }
      if (!Number.isFinite(row.order)) {
        throw new PlayerOptionsRegistryError(`${owner}: row "${row.id}" needs a numeric order.`);
      }
      for (const [otherOwner, otherEntries] of byOwner) {
        if (otherOwner !== owner && otherEntries.some((entry) => entry.row.id === row.id)) {
          throw new PlayerOptionsRegistryError(
            `${owner}: row "${row.id}" belongs to ${otherOwner}; a package never changes another package's rows.`,
          );
        }
      }
    }
    const added = rows.map((row) => ({ owner, row, seq: seq++ }));
    byOwner.set(owner, added);
    return () => {
      if (byOwner.get(owner) === added) {
        byOwner.delete(owner);
      }
    };
  };

  const sections = (ctx: Ctx): PlayerOptionsSectionView<Ctx, Label, Icon>[] => {
    const views: PlayerOptionsSectionView<Ctx, Label, Icon>[] = [];
    for (const section of PLAYER_OPTION_SECTIONS) {
      const rows = entries()
        .filter((entry) => entry.row.section === section && (entry.row.visible?.(ctx) ?? true))
        .map((entry) => ({
          row: entry.row,
          enabled: entry.row.enabled?.(ctx) ?? true,
          value: entry.row.value?.(ctx) ?? null,
        }));
      if (rows.length > 0) {
        views.push({ section, rows });
      }
    }
    return views;
  };

  const all = () => entries().map(({ owner, row }) => ({ owner, row }));

  return { register, sections, all };
}
