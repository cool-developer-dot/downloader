/**
 * P9 Library stats & bookmarks — its rows in the options sheet:
 * - Playback 200: "Don't save watch history" (#687), a switch (app-wide).
 * - Tools 40: "Add bookmark" (#705), at the time playing now (asks for an optional name).
 * - Tools 45: "Bookmarks" (#705), the list (jump, rename, delete); its value is how many.
 * - Tools 90: "Delete video" (#726), after a confirm; then the next video, or the Player closes.
 * Tools 40–45 and 90 are P9's (P10 uses 50–70).
 */

import { playerOptions, playerReady, type PlayerOptionDefinition } from './player-options';

export const P9_OWNER = 'P9';

export const P9_PLAYER_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'p9.disableHistory',
    section: 'playback',
    order: 200,
    label: 'libraryStats.disableHistory',
    subtitle: 'libraryStats.disableHistoryHint',
    icon: 'eye-off',
    visible: (ctx) => ctx.p9 != null,
    toggle: (ctx) => ctx.p9?.historyPaused === true,
    onPress: (ctx) => {
      if (ctx.p9) {
        ctx.p9.setHistoryPaused(!ctx.p9.historyPaused);
      }
    },
  },
  {
    id: 'p9.addBookmark',
    section: 'tools',
    order: 40,
    label: 'libraryStats.addBookmark',
    icon: 'bookmark',
    visible: (ctx) => ctx.p9?.bookmarks.available === true,
    enabled: playerReady,
    onPress: (ctx) => ctx.p9?.bookmarks.add(),
  },
  {
    id: 'p9.bookmarks',
    section: 'tools',
    order: 45,
    label: 'libraryStats.bookmarks',
    icon: 'list',
    visible: (ctx) => ctx.p9?.bookmarks.available === true,
    value: (ctx) => (ctx.p9 && ctx.p9.bookmarks.count > 0 ? String(ctx.p9.bookmarks.count) : null),
    onPress: (ctx) => ctx.p9?.bookmarks.openList(),
  },
  {
    id: 'p9.quickDelete',
    section: 'tools',
    order: 90,
    label: 'libraryStats.quickDelete',
    subtitle: 'libraryStats.quickDeleteHint',
    icon: 'trash-2',
    visible: (ctx) => ctx.p9?.quickDelete.available === true,
    onPress: (ctx) => ctx.p9?.quickDelete.run(),
  },
];

playerOptions.register(P9_OWNER, P9_PLAYER_OPTIONS);
