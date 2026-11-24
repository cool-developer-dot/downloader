/**
 * The pages of the 65-screen design inside the Player (Faran, 2026-11-24): the ⋮ sheet's ways into design 24 "Video
 * tools" (first in Tools) and design 51 "Timers" (after Kid lock). The pages show the packages' own rows; these two
 * only open them.
 */

import { playerOptions, type PlayerOptionDefinition } from './player-options';

export const DESIGN_PAGES_OWNER = 'design-pages';

export const DESIGN_PAGE_OPTIONS: readonly PlayerOptionDefinition[] = [
  {
    id: 'design.videoTools',
    section: 'tools',
    order: 1,
    label: 'playerDesign.optionVideoTools',
    subtitle: 'playerDesign.optionVideoToolsSub',
    icon: 'scissors',
    visible: (ctx) => ctx.designPages != null,
    onPress: (ctx) => ctx.designPages?.openVideoTools(),
  },
  {
    id: 'design.timers',
    section: 'playback',
    order: 165,
    label: 'playerDesign.optionTimers',
    subtitle: 'playerDesign.optionTimersSub',
    icon: 'clock',
    visible: (ctx) => ctx.designPages != null,
    onPress: (ctx) => ctx.designPages?.openTimers(),
  },
];

playerOptions.register(DESIGN_PAGES_OWNER, DESIGN_PAGE_OPTIONS);
