import type WebView from 'react-native-webview';

import { BROWSER_WEBVIEW_BLANK } from '@/browser/constants';

/**
 * Low-level WebView navigation helpers.
 * UI chrome never holds the WebView ref — it goes through the engine hook,
 * which calls these helpers inside event handlers (never during render).
 */
export function stopWebViewLoading(webView: WebView | null | undefined): void {
  webView?.stopLoading();
}

export function reloadWebView(webView: WebView | null | undefined): void {
  webView?.reload();
}

export function goBackWebView(webView: WebView | null | undefined): void {
  webView?.goBack();
}

export function goForwardWebView(webView: WebView | null | undefined): void {
  webView?.goForward();
}

/** In-place navigation that preserves the WebView history stack. */
export function assignWebViewUrl(webView: WebView | null | undefined, url: string): void {
  webView?.injectJavaScript(`window.location.assign(${JSON.stringify(url)}); true;`);
}

/** Replace the current document (used when returning home / blanking). */
export function replaceWebViewUrl(webView: WebView | null | undefined, url: string): void {
  webView?.injectJavaScript(`window.location.replace(${JSON.stringify(url)}); true;`);
}

export function blankWebView(webView: WebView | null | undefined): void {
  stopWebViewLoading(webView);
  replaceWebViewUrl(webView, BROWSER_WEBVIEW_BLANK);
}
