import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewNavigation,
  WebViewProgressEvent,
  WebViewRenderProcessGoneEvent,
  WebViewTerminatedEvent,
} from 'react-native-webview/lib/WebViewTypes';

export type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewNavigation,
  WebViewProgressEvent,
  WebViewRenderProcessGoneEvent,
  WebViewTerminatedEvent,
};

/** Imperative commands the UI chrome may issue to the WebView engine. */
export interface BrowserEngineCommands {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stopLoading: () => void;
  loadUrl: (url: string) => void;
  goHome: () => void;
}
