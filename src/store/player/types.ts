export interface VideoItem {
  id: string;
  url: string;
  title: string | null;
}

export interface PlayerState {
  currentVideo: VideoItem | null;
  playbackPosition: number;
  playbackRate: number;
  fullscreen: boolean;
}

export interface PlayerActions {
  play: (video: VideoItem) => void;
  pause: () => void;
  seek: (position: number) => void;
  reset: () => void;
}

export type PlayerStore = PlayerState & PlayerActions;
