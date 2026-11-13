import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { useDuplicateActionStore } from '@/downloads/v2/duplicate-action-store';
import { useNetworkOptionsStore } from '@/downloads/v2/network-options-store';
import { useSaveLocationStore } from '@/downloads/v2/save-location-store';
import { useSubtitleSettingsStore } from '@/downloads/v2/subtitle-store';

import { resetDownloaderStores } from './downloader-stores-reset';
import { planSettingsChanges } from './settings-apply-plan';

describe('Reset / import settings reach every downloader setting', () => {
  test('the four policy-backed settings go through the download policy, the rest to the store', () => {
    const plan = planSettingsChanges([
      ['wifiOnly', false],
      ['autoResume', true],
      ['notifications', true],
      ['maxConcurrentDownloads', 2],
      ['filenameTemplate', '{title}'],
      ['tapToToggle', false],
    ]);
    assert.deepEqual(plan.policy, { wifiOnly: false, autoResume: true, notificationsEnabled: true, maxConcurrentDownloads: 2 });
    assert.deepEqual(plan.store, [
      ['filenameTemplate', '{title}'],
      ['tapToToggle', false],
    ]);
    assert.deepEqual(planSettingsChanges([['language', 'ur']]), { policy: {}, store: [['language', 'ur']] });
  });

  test('duplicate choice, subtitles, the extra folder copy and advanced network go back to their defaults', () => {
    useDuplicateActionStore.getState().setAction('ask');
    useSubtitleSettingsStore.getState().setEnabled(true);
    useSubtitleSettingsStore.getState().setMode('all');
    useSaveLocationStore.getState().dispatch({ type: 'picked', treeUri: 'content://tree/x', folderName: 'Documents', now: 1 });
    useNetworkOptionsStore.getState().setRetryLimit('3');

    resetDownloaderStores();

    assert.equal(useDuplicateActionStore.getState().action, 'skip');
    assert.equal(useSubtitleSettingsStore.getState().enabled, false);
    assert.equal(useSubtitleSettingsStore.getState().mode, 'app_language');
    assert.equal(useSaveLocationStore.getState().enabled, false);
    assert.equal(useSaveLocationStore.getState().treeUri, null);
    assert.equal(useNetworkOptionsStore.getState().retryLimit, 'automatic');
  });
});
