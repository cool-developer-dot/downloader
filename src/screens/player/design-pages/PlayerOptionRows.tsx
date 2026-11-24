import { memo, type ReactNode } from 'react';

import { DsRow, DsRowGroup, type DsIconName } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import { playerOptions, type PlayerOptionContext } from '@/player/options';

/**
 * Rows that leave the Player (another screen, the Private Folder, deleting the video): the page closes first, as the
 * ⋮ sheet does. Every other row keeps the page open, and the sheet it opens comes up above it.
 */
const CLOSES_PAGE = new Set(['p10.trim', 'p11.moveToPrivate', 'p9.quickDelete', 'p1.saveToLibrary', 'p14.downloadStream']);

export type PlayerOptionRowsProps = {
  context: PlayerOptionContext;
  /** The registry rows to show, in this order (a row that is hidden for this video is left out). */
  ids: readonly string[];
  onClosePage: () => void;
  /** The design's own title for a row (screen 22's "Night mode audio"). */
  titles?: Readonly<Record<string, TranslationKey>>;
  /** The design's own icon for a row (screen 20's hand for Gesture controls). */
  icons?: Readonly<Record<string, DsIconName>>;
  /** Design-only rows after the registry's. */
  children?: ReactNode;
  testID?: string;
};

/**
 * A design card of the ⋮ sheet's rows (src/player/options): the same row, value, switch and action the packages
 * registered, so a page and the ⋮ sheet never disagree.
 */
export const PlayerOptionRows = memo(function PlayerOptionRows({
  context,
  ids,
  onClosePage,
  titles,
  icons,
  children,
  testID,
}: PlayerOptionRowsProps) {
  const { t } = useTranslation();
  const byId = new Map(
    playerOptions
      .sections(context)
      .flatMap((section) => section.rows)
      .map((entry) => [entry.row.id, entry] as const),
  );
  const rows = ids.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
  if (rows.length === 0 && !children) {
    return null;
  }
  return (
    <DsRowGroup testID={testID}>
      {rows.map(({ row, enabled, value, toggle }) => {
        const title = t(titles?.[row.id] ?? row.label);
        const subtitle = row.subtitle ? t(row.subtitle) : undefined;
        return toggle != null ? (
          <DsRow
            key={row.id}
            icon={icons?.[row.id] ?? row.icon}
            title={title}
            subtitle={subtitle}
            toggle={{ value: toggle, onValueChange: () => row.onPress(context), accessibilityHint: subtitle }}
            disabled={!enabled}
            testID={`player-page-${row.id}`}
          />
        ) : (
          <DsRow
            key={row.id}
            icon={icons?.[row.id] ?? row.icon}
            title={title}
            subtitle={subtitle}
            value={value ?? undefined}
            disabled={!enabled}
            onPress={() => {
              if (CLOSES_PAGE.has(row.id)) {
                onClosePage();
                requestAnimationFrame(() => row.onPress(context));
              } else {
                row.onPress(context);
              }
            }}
            testID={`player-page-${row.id}`}
          />
        );
      })}
      {children}
    </DsRowGroup>
  );
});

/** Whether a registry row shows for this video (a tile of screen 24 follows the same rule). */
export function playerOptionEntry(context: PlayerOptionContext, id: string) {
  for (const section of playerOptions.sections(context)) {
    const entry = section.rows.find((candidate) => candidate.row.id === id);
    if (entry) {
      return entry;
    }
  }
  return null;
}

export const CLOSES_PAGE_IDS: ReadonlySet<string> = CLOSES_PAGE;
