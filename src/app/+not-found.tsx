import { Redirect, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';

import { resolveFallbackRoute } from '@/navigation';

/**
 * An unknown link while the app is running goes back to where the user was. Redirecting instead replaced this screen
 * with a second copy of the app's navigator on top of the first one. Only with nothing to go back to (a cold start)
 * does it redirect to the start route.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  const [fallback] = useState<Href | null>(() =>
    router.canGoBack() ? null : (resolveFallbackRoute() as Href),
  );

  useEffect(() => {
    if (!fallback) {
      router.back();
    }
  }, [fallback, router]);

  return fallback ? <Redirect href={fallback} /> : null;
}
