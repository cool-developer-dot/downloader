/**
 * The Player's options sheet. Each package's rows are registered by importing its file here — one line per package,
 * in package order (the import is the registration).
 */
import './p1-playback-basics';
import './p2-video-fit';
import './p3-subtitles';

export {
  playerOptions,
  playerReady,
  type PlayerOptionContext,
  type PlayerOptionDefinition,
  type PlayerOptionUi,
} from './player-options';
export {
  PLAYER_OPTION_SECTIONS,
  PlayerOptionsRegistryError,
  createPlayerOptionsRegistry,
  type PlayerOptionRow,
  type PlayerOptionSection,
  type PlayerOptionsRegistry,
  type PlayerOptionsSectionView,
} from './registry';
