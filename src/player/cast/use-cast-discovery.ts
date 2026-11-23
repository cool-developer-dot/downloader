import { useEffect } from 'react';

import { holdCastDiscovery } from './cast.runtime';

/** P13 #667: Cast devices are looked for only while the Player screen is open (MediaRouter discovery stops after). */
export function useCastDiscovery(): void {
  useEffect(() => holdCastDiscovery(), []);
}
