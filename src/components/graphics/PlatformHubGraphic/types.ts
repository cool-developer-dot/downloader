import type { ComponentType, ReactNode } from 'react';

export type PlatformBrandIconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export type PlatformHubItemId =
  | 'video'
  | 'social'
  | 'media'
  | 'player'
  | 'library'
  | 'private'
  | 'browser'
  | 'pasteLink'
  | 'download';

export type PlatformHubItemKind = 'platform' | 'capability';

export type PlatformHubItem = {
  id: PlatformHubItemId;
  label: string;
  kind: PlatformHubItemKind;
  Icon: ComponentType<PlatformBrandIconProps>;
  brandColor: string;
  enterDx: number;
  enterDy: number;
};

export type PlatformHubOrbitPosition = {
  item: PlatformHubItem;
  index: number;
  angleDeg: number;
  angleRad: number;
  x: number;
  y: number;
  distance: number;
};

export type PlatformHubLayoutMetrics = {
  size: number;
  orbitRadius: number;
  positions: PlatformHubOrbitPosition[];
};

export type PlatformHubGraphicProps = {
  center?: ReactNode;
  animated?: boolean;
  enabled?: boolean;
  variant?: 'hero' | 'compact';
  testID?: string;
};

export type PlatformHubIconAnim = {
  opacity: import('react-native-reanimated').SharedValue<number>;
  scale: import('react-native-reanimated').SharedValue<number>;
  enterX: import('react-native-reanimated').SharedValue<number>;
  enterY: import('react-native-reanimated').SharedValue<number>;
  floatX: import('react-native-reanimated').SharedValue<number>;
  floatY: import('react-native-reanimated').SharedValue<number>;
  connection: import('react-native-reanimated').SharedValue<number>;
};
