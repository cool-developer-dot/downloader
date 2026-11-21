/** Light theme (CEO design) — `lightTabs` screen strings: design 2 "Browser · Tabs" and 35 "Tab · Long-press menu". */
export const lightTabsEn = {
  // Header subtitle: "5 tabs · 2 groups" (the plural "{count} tabs" is browserTabGroups.closedGroupTabs).
  subtitle: '{tabs} · {groups}',
  tabsOne: '1 tab',
  groupsOne: '1 group',
  groupsOther: '{count} groups',
  // Filter chips ("All" is downloads.filterAll, "Incognito" is browserIncognito.badge).
  filterGroups: 'Groups',
  filterSleeping: 'Sleeping',
  // The grid.
  newTile: 'New',
  sleeping: 'Sleeping',
  tileA11y: '{title}, {site}',
  newTabHint: 'Opens a new tab and shows it',
  // GROUP HISTORY.
  groupHistory: 'Group history',
  smartGrouping: 'Smart Tab Grouping',
  smartGroupingHint: 'Auto-group by site',
  timeline: 'Tab Timeline',
  timelineHint: 'Recently closed',
  // MANAGE (the old switcher's menu, kept reachable).
  manage: 'Manage',
  // Tab options (design 35).
  sleepTab: 'Sleep tab',
  sleepTabHint: 'Frees its page; it loads again when you open the tab',
  sleepTabBlocked: 'The tab in front, or one playing sound, stays awake',
  linkLongPress: 'Link long-press',
  openInBackground: 'Open in background',
  openInBackgroundHint: 'This page again in a new tab, behind this one',
  openInIncognitoHint: 'This page in a new incognito tab',
  tabGone: 'That tab is closed',
} as const;
