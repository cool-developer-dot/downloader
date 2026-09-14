import { memo } from 'react';

import { ensurePhase1SocialSourceRefreshRegistered } from '../social-source/register-phase1-source-refresh';
import { useMediaDetectionBrowserSync } from '../hooks';

// Phase 4C — register once at host mount boundary (no React in provider).
ensurePhase1SocialSourceRefreshRegistered();

/**
 * Invisible host that keeps the Media Detection Engine synchronized
 * with browser navigation. Renders nothing — no download UI.
 */
export const MediaDetectionHost = memo(function MediaDetectionHost() {
  useMediaDetectionBrowserSync();
  return null;
});
