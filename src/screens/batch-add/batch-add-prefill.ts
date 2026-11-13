/**
 * Text handed to the next Batch Add screen (Page Link Grabber, #484): the links found on a page, one per line. In
 * memory only and taken once, so reopening Batch Add later starts empty again.
 */
let pendingText: string | null = null;

export const batchAddPrefill = {
  set(text: string): void {
    pendingText = text.trim() ? text : null;
  },
  take(): string | null {
    const text = pendingText;
    pendingText = null;
    return text;
  },
};
