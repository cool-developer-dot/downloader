import { type PropsWithChildren } from 'react';

/**
 * Session lifecycle is owned by bootstrap (`runAppInitializer`).
 * This provider is a stable extension point for future local listeners
 * without changing route trees.
 */
export function SessionProvider({ children }: PropsWithChildren) {
  return children;
}
