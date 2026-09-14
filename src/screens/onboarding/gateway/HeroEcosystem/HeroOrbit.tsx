import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { HeroConnection } from './HeroConnections';
import { HeroIcon } from './HeroIcon';
import type { HeroIconAnim } from './useHeroEcosystemSequence';
import type { HeroOrbitPosition } from './useHeroOrbitLayout';

type HeroOrbitProps = {
  size: number;
  positions: HeroOrbitPosition[];
  icons: HeroIconAnim[];
  focusOpacity: SharedValue<number>;
  center: ReactNode;
};

/**
 * Perfect circular orbit: every icon shares one radius from the logo center.
 */
export const HeroOrbit = memo(function HeroOrbit({
  size,
  positions,
  icons,
  focusOpacity,
  center,
}: HeroOrbitProps) {
  const origin = size / 2;

  return (
    <View style={[styles.orbit, { width: size, height: size }]}>
      {positions.map((pos) => (
        <HeroConnection
          key={`pulse-${pos.item.id}`}
          x={pos.x}
          y={pos.y}
          distance={pos.distance}
          angleRad={pos.angleRad}
          center={origin}
          progress={icons[pos.index].connection}
        />
      ))}

      <View style={styles.logoSlot} pointerEvents="box-none">
        {center}
      </View>

      {positions.map((pos) => (
        <HeroIcon
          key={pos.item.id}
          item={pos.item}
          x={pos.x}
          y={pos.y}
          center={origin}
          anim={icons[pos.index]}
          focusOpacity={focusOpacity}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  orbit: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  logoSlot: {
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
