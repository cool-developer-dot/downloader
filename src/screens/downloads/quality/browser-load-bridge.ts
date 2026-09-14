/**
 * Browser tab registers loadUrl so page resolution can trigger WebView loads
 * without a second hidden WebView.
 */
let browserLoadUrl: ((url: string) => void) | null = null;

export function registerBrowserLoadUrl(loadUrl: (url: string) => void): () => void {
  browserLoadUrl = loadUrl;
  return () => {
    if (browserLoadUrl === loadUrl) {
      browserLoadUrl = null;
    }
  };
}

export function invokeBrowserLoadUrl(url: string): void {
  browserLoadUrl?.(url);
}
