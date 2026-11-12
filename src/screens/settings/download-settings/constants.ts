/** Constants for Settings → Download Settings. */

export const CONCURRENT_SEGMENT_OPTIONS = [
  { value: '1' as const, label: '1', accessibilityLabel: '1 simultaneous download' },
  { value: '2' as const, label: '2', accessibilityLabel: '2 simultaneous downloads' },
  { value: '3' as const, label: '3', accessibilityLabel: '3 simultaneous downloads' },
  { value: '4' as const, label: '4', accessibilityLabel: '4 simultaneous downloads' },
];

/** "Connections per file" choices (accessibility labels are translated on the screen). */
export const CONNECTION_SEGMENT_OPTIONS = [
  { value: '1' as const, label: '1' },
  { value: '2' as const, label: '2' },
  { value: '3' as const, label: '3' },
  { value: '4' as const, label: '4' },
];
