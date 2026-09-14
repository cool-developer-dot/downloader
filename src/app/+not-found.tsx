import { Redirect, type Href } from 'expo-router';

import { resolveFallbackRoute } from '@/navigation';

export default function NotFoundScreen() {
  return <Redirect href={resolveFallbackRoute() as Href} />;
}
