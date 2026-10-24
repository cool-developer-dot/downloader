import { useCallback } from 'react';
import type { View } from 'react-native';

import type { Rect } from './tour-layout';

/**
 * The real UI elements the tour points at. Each registers its native view while mounted; the tour measures it in
 * window coordinates when its step comes up. A target that is not mounted (e.g. the start page while a site is open)
 * measures as null and its step is skipped.
 */
export type TourTargetId = 'addressBar' | 'startPage' | 'pageArea' | 'downloadsTab' | 'playerTab' | 'settingsTab';

const targets = new Map<TourTargetId, View>();

/** Ref callback for a tour target. Give the view `collapsable={false}` so Android keeps a native view to measure. */
export function useTourTargetRef(id: TourTargetId): (node: View | null) => void {
  return useCallback(
    (node: View | null) => {
      if (node) {
        targets.set(id, node);
      } else if (targets.get(id)) {
        targets.delete(id);
      }
    },
    [id],
  );
}

const MEASURE_TIMEOUT_MS = 600;

export function measureTourTarget(id: TourTargetId): Promise<Rect | null> {
  const node = targets.get(id);
  if (!node) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(null);
    }, MEASURE_TIMEOUT_MS);
    try {
      node.measureInWindow((x, y, width, height) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ x, y, width, height });
      });
    } catch {
      settled = true;
      clearTimeout(timer);
      resolve(null);
    }
  });
}
