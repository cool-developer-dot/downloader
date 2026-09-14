/** Multi-range progressive acceleration constants (progressive only). */

import { DOWNLOAD_ENGINE } from '../constants';

export const MULTI_RANGE = {
  workspaceFolderName: '.mranges',
  mergeTempName: 'merge.tmp',
  maxRangesPerFile: DOWNLOAD_ENGINE.maxRangesPerFile,
  maxGlobalNetworkWorkers: DOWNLOAD_ENGINE.maxGlobalNetworkWorkers,
  minBytes: DOWNLOAD_ENGINE.minMultiRangeBytes,
  mediumBytes: DOWNLOAD_ENGINE.multiRangeMediumBytes,
  largeBytes: DOWNLOAD_ENGINE.multiRangeLargeBytes,
  diskMarginBytes: DOWNLOAD_ENGINE.multiRangeDiskMarginBytes,
  persistIntervalMs: DOWNLOAD_ENGINE.multiRangePersistIntervalMs,
  /** Chunk size for part writes / merge copy. */
  ioChunkBytes: 256 * 1024,
  /** Per-range HTTP timeout. */
  requestTimeoutMs: 60_000,
} as const;
