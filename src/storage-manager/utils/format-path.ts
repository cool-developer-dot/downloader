/** Convert a file URI into a readable path for display. */
export function formatStoragePath(uri: string): string {
  if (!uri) {
    return '';
  }

  try {
    if (uri.startsWith('file://')) {
      return decodeURIComponent(uri.replace(/^file:\/\//, '/'));
    }
    return uri;
  } catch {
    return uri;
  }
}
