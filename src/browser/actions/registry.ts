import type { BrowserActionContext, BrowserLongPressAction } from './types';

const registry = new Map<string, BrowserLongPressAction>();

/**
 * Extensible browser action registry.
 * Future phases register additional actions without modifying sheet UI.
 */
export const browserActionRegistry = {
  register(action: BrowserLongPressAction): void {
    registry.set(action.id, action);
  },

  unregister(id: string): void {
    registry.delete(id);
  },

  get(id: string): BrowserLongPressAction | undefined {
    return registry.get(id);
  },

  /**
   * Returns actions available for the given context, sorted by `order`.
   * Includes disabled placeholders so the sheet can surface future affordances.
   */
  resolve(context: BrowserActionContext): BrowserLongPressAction[] {
    return Array.from(registry.values())
      .filter((action) => action.isAvailable?.(context) !== false)
      .sort((a, b) => a.order - b.order);
  },

  clear(): void {
    registry.clear();
  },
} as const;
