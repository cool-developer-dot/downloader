import { type Href, usePathname, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';

import type { RoutePath } from '../constants/route-paths';
import { replace } from '../helpers/navigation';

type InitialRouteRedirectProps = {
  href: Href | RoutePath;
};

function normalizePath(value: string): string {
  if (value.length > 1 && value.endsWith('/')) {
    return value.slice(0, -1);
  }
  return value;
}

/**
 * Redirects once after the root navigator reports a mounted state key.
 * Runs only in useEffect (never during render).
 */
export function InitialRouteRedirect({ href }: InitialRouteRedirectProps) {
  const navigationState = useRootNavigationState();
  const pathname = usePathname();
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    if (!navigationState?.key || hasRedirectedRef.current) {
      return;
    }

    const target = normalizePath(String(href));
    const current = normalizePath(pathname);

    if (current === target) {
      hasRedirectedRef.current = true;
      return;
    }

    hasRedirectedRef.current = true;
    replace(href as Href);
  }, [href, navigationState?.key, pathname]);

  return null;
}
