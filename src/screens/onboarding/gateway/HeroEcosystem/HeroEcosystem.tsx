import { memo, type ReactNode } from 'react';

import { PlatformHubGraphic } from '@/components/graphics';

type HeroEcosystemProps = {
  center: ReactNode;
  enabled?: boolean;
};

/** @deprecated Prefer `PlatformHubGraphic` — kept for gateway import stability. */
export const HeroEcosystem = memo(function HeroEcosystem({
  center,
  enabled = true,
}: HeroEcosystemProps) {
  return (
    <PlatformHubGraphic center={center} enabled={enabled} animated variant="hero" />
  );
});
