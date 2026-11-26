/**
 * Faran's File Manager packages (F12–F17): the low space alert (F14), SD card and the folders added through Android's
 * folder picker (F15), opening files from other apps (F16). Hamza's File Manager screens use their own catalog
 * (`files.en.ts`). `filesCore.ur.ts` mirrors it.
 */
export const filesCoreEn = {
  // F14 · #855 Low space alert
  lowSpaceChannel: 'Low storage',
  lowSpaceTitle: 'Phone storage is low',
  lowSpaceBody: '{free} left. Open VidoraX → Files → Storage to free space.',
  // F16 · #873 Default app, #947 File associations
  openWithTitle: 'Open videos with VidoraX',
  openWithSub: 'Android lets you pick the default app: App info → Open by default',
  openWithHint: 'Opens VidoraX’s app info in Android settings',
} as const;
