import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { PlatformHubCenterLogo } from './PlatformHubCenterLogo';
import { PlatformHubConnection } from './PlatformHubConnections';
import { PlatformHubIconNode } from './PlatformHubIconNode';
import { PlatformHubRadialGuide } from './PlatformHubRadialGuide';
import { PlatformHubSpokes } from './PlatformHubSpokes';
import type { PlatformHubGraphicProps } from './types';
import { usePlatformHubLayout } from './usePlatformHubLayout';
import { usePlatformHubSequence } from './usePlatformHubSequence';

/**
 * Premium radial platform hub — VidoraX logo center with orbiting media sources.
 * Reusable on onboarding, home hero, or any media-sources showcase surface.
 */
export const PlatformHubGraphic = memo(function PlatformHubGraphic({
  center,
  animated = true,
  enabled = true,
  variant = 'hero',
  testID = 'platform-hub-graphic',
}: PlatformHubGraphicProps) {
  const layout = usePlatformHubLayout(variant);
  const sequence = usePlatformHubSequence({ enabled: enabled && animated });
  const origin = layout.size / 2;

  const centerNode: ReactNode = center ?? <PlatformHubCenterLogo variant={variant} />;

  return (
    <View
      style={[styles.root, { width: layout.size, height: layout.size }]}
      testID={testID}
      accessibilityRole="image"
      accessible>
      <PlatformHubRadialGuide size={layout.size} orbitRadius={layout.orbitRadius} />
      <PlatformHubSpokes size={layout.size} center={origin} positions={layout.positions} />

      {animated
        ? layout.positions.map((pos) => (
            <PlatformHubConnection
              key={`pulse-${pos.item.id}`}
              x={pos.x}
              y={pos.y}
              distance={pos.distance}
              center={origin}
              progress={sequence.icons[pos.index]!.connection}
            />
          ))
        : null}

      <View style={styles.logoSlot} pointerEvents="box-none">
        {centerNode}
      </View>

      {layout.positions.map((pos) => (
        <PlatformHubIconNode
          key={pos.item.id}
          item={pos.item}
          x={pos.x}
          y={pos.y}
          center={origin}
          variant={variant}
          anim={animated ? sequence.icons[pos.index] : undefined}
          focusOpacity={animated ? sequence.focusOpacity : undefined}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  logoSlot: {
    zIndex: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
