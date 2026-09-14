/**
 * Normalized download network state — scheduler never imports NetInfo enums directly.
 */

export type DownloadNetworkType =
  | 'wifi'
  | 'cellular'
  | 'ethernet'
  | 'vpn'
  | 'other'
  | 'unknown'
  | 'none';

export type DownloadNetworkState = {
  connected: boolean;
  /** null = unknown reachability */
  internetReachable: boolean | null;
  type: DownloadNetworkType;
};

export const DEFAULT_DOWNLOAD_NETWORK_STATE: DownloadNetworkState = {
  connected: true,
  internetReachable: null,
  type: 'unknown',
};

export type DownloadNetworkListener = (state: DownloadNetworkState) => void;
