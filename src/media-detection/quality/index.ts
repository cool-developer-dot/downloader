export {
  AUDIO_FORMAT_LABELS,
  DISCOVERY_ANIMATION,
  DISCOVERY_LAYOUT,
  QUALITY_LADDER,
} from './quality.constants';
export type { QualityLabel } from './quality.constants';
export {
  labelFromHeight,
  resolveAudioOptions,
  resolveQualities,
} from './quality.resolver';
export type { AudioExtractionOption, ResolvedQuality } from './quality.resolver';
