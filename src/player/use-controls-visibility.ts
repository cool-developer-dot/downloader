/**
 * Controls visibility — single timer, force-visible rules.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ControlsVisibilityController,
  shouldForceControlsVisible,
  type ControlsVisibilityInput,
} from './controls-visibility';

export function useControlsVisibility(
  input: ControlsVisibilityInput,
): {
  controlsVisible: boolean;
  showControls: () => void;
  hideControls: () => void;
  toggleControls: () => void;
  bumpControls: () => void;
} {
  const [controlsVisible, setControlsVisible] = useState(true);
  const controllerRef = useRef<ControlsVisibilityController | null>(null);

  if (controllerRef.current == null) {
    controllerRef.current = new ControlsVisibilityController({
      onChange: setControlsVisible,
    });
  }

  const force = shouldForceControlsVisible(input);

  useEffect(() => {
    controllerRef.current?.setForceVisible(force);
  }, [force]);

  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  const showControls = useCallback(() => {
    controllerRef.current?.show();
  }, []);

  const hideControls = useCallback(() => {
    controllerRef.current?.hide();
  }, []);

  const toggleControls = useCallback(() => {
    controllerRef.current?.toggle();
  }, []);

  const bumpControls = useCallback(() => {
    controllerRef.current?.bump();
  }, []);

  return {
    controlsVisible,
    showControls,
    hideControls,
    toggleControls,
    bumpControls,
  };
}
