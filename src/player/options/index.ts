/**
 * The Player's options sheet. Each package's rows are registered by importing its file here — one line per package,
 * in package order (the import is the registration).
 */
import './p1-playback-basics';
import './p2-video-fit';
import './p3-subtitles';
import './p4-subtitle-style';
import './p5-repeat';
import './p6-queue';
import './p7-playlists';
import './p8-gestures';
import './p9-library-stats';
import './p10-edit-tools';
import './p14-streams';
import './p15-headset-keys';
import './p16-speed';
import './p17-audio';

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
