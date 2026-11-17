/**
 * Design kit dimensions — measured from the CEO's handoff "VidoraX · Light theme UI · 65 screens" (the PDF's vector
 * data, scaled so each 239.2 pt phone frame is a 360 dp screen). Colours come from the active theme
 * (`theme.colors`): the same numbers hold for all six themes (Light, Dark, Red, Cream, Midnight, Blush). The Red
 * theme adds a full-width 85 dp accent header band and a 52 × 26 white pill behind the active tab's icon.
 *
 * Reference measurements (dp): screen padding 16.9; header title 21.4 at y 23, subtitle 12.4 at y 52; round header
 * button 35 × 35 r 10.7; search field 56 r 15.2; card r 15.2 with 13 inner padding; list row = 34 × 34 r 10.2 icon
 * tile, 12 gap, title 14.7, subtitle 12.4, 57.6 tall, 1.1 divider; toggle 42.9 × 24.8 r 12.4, thumb 18.1; chip
 * 30.5 tall r 15.2, text 13.5; quick-access tile 101.6 × 70 r 13, icon 20.7, label 12.4; buttons 45 tall r 12.4,
 * text 14.7; section label 12.4 red caps; bottom bar 60.9 tall + 1.1 top line, icon 18.8 (stroke 2.2), label 11.3.
 */
export const ds = {
  space: {
    screenX: 16,
    /** Card inner padding (29.9 − 16.9). */
    cardPad: 13,
    /** Gap between the icon tile and a row's text. */
    rowGap: 12,
    /** A list row's vertical padding (tile at 11.8 from the card top). */
    rowPadY: 12,
    /** Space before a section label (tiles end 299, label 314). */
    sectionTop: 16,
    /** Space after a section label (label 314 + 12 → card 337). */
    sectionBottom: 10,
    /** Space between stacked cards / blocks. */
    stack: 12,
    /** Grid gap for tiles (10.4). */
    grid: 10,
    /** Chip gap (8.5). */
    chip: 8,
    /** Header: top padding, title → subtitle, header → content. */
    headerTop: 20,
    headerTitleGap: 6,
    headerBottom: 14,
  },
  radius: {
    card: 16,
    tile: 13,
    button: 12,
    iconTile: 10,
    iconButton: 11,
    chip: 16,
    field: 16,
    progress: 3,
    fab: 25,
    thumb: 8,
    toggle: 12.5,
  },
  size: {
    headerButton: 36,
    headerButtonIcon: 18,
    /** The Red theme's header band: from the top of the safe area to the band's square bottom edge. */
    headerBand: 85,
    /** The Red theme's pill behind the active tab icon. */
    tabPillWidth: 52,
    tabPillHeight: 26,
    iconTile: 34,
    rowIcon: 17,
    rowMinHeight: 58,
    rowChevron: 18,
    toggleWidth: 43,
    toggleHeight: 25,
    toggleThumb: 18,
    chipHeight: 31,
    chipPadX: 13,
    button: 45,
    buttonIcon: 16,
    field: 56,
    fieldIcon: 18,
    tile: 70,
    tileIcon: 21,
    tabBar: 61,
    tabIcon: 20,
    progress: 6,
    fab: 50,
    /** Download / recent-item thumbnail (54 × 45). */
    thumbWidth: 54,
    thumbHeight: 45,
    hero: 45,
    stat: 34,
  },
  stroke: {
    tile: 2,
    row: 1.6,
    tabBar: 2.1,
    header: 1.7,
  },
  text: {
    title: 22,
    titleLine: 28,
    subtitle: 12.5,
    subtitleLine: 17,
    rowTitle: 15,
    rowTitleLine: 20,
    rowSub: 12.5,
    rowSubLine: 17,
    rowValue: 13.5,
    section: 12,
    sectionLine: 16,
    sectionTracking: 0.6,
    chip: 13.5,
    chipLine: 18,
    button: 15,
    tile: 12.5,
    tileLine: 16,
    body: 13,
    bodyLine: 18,
    tabLabel: 11,
    tabLabelLine: 14,
    hero: 45,
    heroLine: 52,
    stat: 34,
    statLine: 40,
    cardTitle: 16,
    cardTitleLine: 22,
    fab: 17,
  },
  /** Elevation of the floating "Add link" pill and the header buttons (soft, red-tinted in the design). */
  shadow: {
    fab: {
      shadowColor: '#D92D20',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.28,
      shadowRadius: 12,
      elevation: 6,
    },
    headerButton: {
      shadowColor: '#16161A',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 2,
      elevation: 1,
    },
  },
} as const;

/** The design's thumbnail fills: a dark green for a finished video, slate for a transfer in progress. */
export const dsThumbColors = {
  video: { base: '#15321F', light: '#2E5A3A' },
  transfer: { base: '#5C6678', light: '#8A93A3' },
} as const;
