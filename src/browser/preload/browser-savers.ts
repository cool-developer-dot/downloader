/**
 * Whether a saver mode turns the browser's extra network work off (B6 #55 preloading). B18 (Data saver / Battery
 * saver) answers this; until then nothing is saving.
 */
export type BrowserSavers = { dataSaver: boolean; batterySaver: boolean };

let reader: () => BrowserSavers = () => ({ dataSaver: false, batterySaver: false });

export function bindBrowserSaversReader(next: () => BrowserSavers): void {
  reader = next;
}

export function browserSaverOn(): boolean {
  try {
    const savers = reader();
    return savers.dataSaver || savers.batterySaver;
  } catch {
    return false;
  }
}
