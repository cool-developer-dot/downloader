import { useMemo } from 'react';

import {
  buildMediaDetectionBeforeContentScript,
  buildMediaDetectionInjectedScript,
} from '../observers';
import { mediaDetectionEngine } from '../engine';

export type MediaDetectionWebViewBindings = {
  injectedJavaScript: string;
  injectedJavaScriptBeforeContentLoaded: string;
  onMessage: (raw: string) => void;
};

/**
 * Provides WebView injection + message bindings for the Media Detection Engine.
 * Lifecycle start/stop is owned by MediaDetectionHost — bridge only forwards messages.
 */
export function useMediaDetectionBridge(): MediaDetectionWebViewBindings {
  const injectedJavaScript = useMemo(
    () => buildMediaDetectionInjectedScript(),
    [],
  );

  const injectedJavaScriptBeforeContentLoaded = useMemo(
    () => buildMediaDetectionBeforeContentScript(),
    [],
  );

  return useMemo(
    () => ({
      injectedJavaScript,
      injectedJavaScriptBeforeContentLoaded,
      onMessage: (raw: string) => {
        mediaDetectionEngine.handleWebViewMessage(raw);
      },
    }),
    [injectedJavaScript, injectedJavaScriptBeforeContentLoaded],
  );
}
