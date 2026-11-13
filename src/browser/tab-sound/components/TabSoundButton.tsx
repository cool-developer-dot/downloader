import { memo, useSyncExternalStore } from 'react';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { pageActivity } from '@/browser/scroll/page-activity';
import { useTranslation } from '@/localization';

import { tabAudio } from '../tab-audio.service';

/** Whether the tab's page plays sound (B6's `media_state`) and whether the user muted it. */
export function useTabSound(tabId: string): { playing: boolean; muted: boolean } {
  'use no memo'; // Reads external state each render (subscribed above): compiled, the React Compiler cached the first read.
  const playing = useSyncExternalStore(pageActivity.subscribe, () => pageActivity.isMediaPlaying(tabId));
  useSyncExternalStore(tabAudio.subscribe, tabAudio.getVersion, tabAudio.getVersion);
  return { playing, muted: tabAudio.get(tabId).muted };
}

/**
 * B3 #283 / #8 — the speaker on a tab card while its page plays sound (or while it is muted): a tap mutes or unmutes
 * just that tab. 48 dp; nothing is drawn for a silent, unmuted tab.
 */
export const TabSoundButton = memo(function TabSoundButton({ tabId, title }: { tabId: string; title: string }) {
  const { t } = useTranslation();
  const { playing, muted } = useTabSound(tabId);
  if (!playing && !muted) return null;
  return (
    <Pressable
      testID={`tab-sound-${tabId.slice(0, 8)}`}
      accessibilityRole="button"
      accessibilityLabel={muted ? t('browserTabSound.unmuteA11y', { title }) : t('browserTabSound.muteA11y', { title })}
      accessibilityState={{ checked: muted }}
      onPress={() => tabAudio.setMuted(tabId, !muted)}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={muted ? 'volume-off' : 'volume-high'} size={20} color={muted ? 'secondary' : 'primary'} />
    </Pressable>
  );
});
