import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DownloadQualityOption } from '@/downloads/quality';

import { isStandaloneDownloadableQuality, selectVerifiedStandaloneQualities } from './verified-quality-options';

/** A quality row as the offer carries it; only the fields this filter reads matter. */
function option(overrides: Partial<DownloadQualityOption>): DownloadQualityOption {
  return {
    id: 'q1',
    label: '720p',
    sourceUrl: 'https://cdn.test/clip.mp4',
    container: 'mp4',
    height: 720,
    downloadable: true,
    ...overrides,
  } as DownloadQualityOption;
}

const SEGMENT = 'https://upos.test/upgcxcode/23/15/42382331523/42382331523-1-100022.m4s';
const AUDIO = 'https://upos.test/upgcxcode/23/15/42382331523/42382331523-1-30216.m4s';

describe('which quality rows may be offered on their own', () => {
  it('a whole file is offered', () => {
    assert.equal(isStandaloneDownloadableQuality(option({})), true);
  });

  it('a lone segment is not', () => {
    assert.equal(isStandaloneDownloadableQuality(option({ sourceUrl: SEGMENT })), false);
  });

  it('a proven split pair is, although its video file is named like a segment', () => {
    assert.equal(
      isStandaloneDownloadableQuality(option({ sourceUrl: SEGMENT, audioSourceUrl: AUDIO })),
      true,
    );
    assert.equal(
      selectVerifiedStandaloneQualities([option({ sourceUrl: SEGMENT, audioSourceUrl: AUDIO })]).length,
      1,
    );
  });

  it('a split pair is still refused when it is not downloadable or is protected', () => {
    assert.equal(
      isStandaloneDownloadableQuality(option({ sourceUrl: SEGMENT, audioSourceUrl: AUDIO, downloadable: false })),
      false,
    );
    assert.equal(
      isStandaloneDownloadableQuality(
        option({ sourceUrl: SEGMENT, audioSourceUrl: AUDIO, unavailableReason: 'DRM_PROTECTED' }),
      ),
      false,
    );
  });

  it('an empty audio URL is no pair', () => {
    assert.equal(isStandaloneDownloadableQuality(option({ sourceUrl: SEGMENT, audioSourceUrl: '  ' })), false);
  });
});
