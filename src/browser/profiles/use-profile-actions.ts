import { useCallback } from 'react';

import { useTranslation } from '@/localization';
import { GUEST_PROFILE_ID } from '@/storage/profile/active-profile';

import { announceProfileMessage } from './profile-feedback';
import { profileDisplayName, type BrowserProfile } from './profile-registry';
import { enterGuest, exitGuest, switchProfile, useProfilesStore } from './profile-service';

/** B20: switching profiles and guest mode from any screen, with the same feedback everywhere. */
export function useProfileActions() {
  const { t } = useTranslation();
  const defaultName = t('browserProfiles.defaultName');

  const displayName = useCallback(
    (profile: BrowserProfile) => profileDisplayName(profile, defaultName),
    [defaultName],
  );

  const switchTo = useCallback(
    async (id: string) => {
      const outcome = await switchProfile(id);
      if (outcome === 'busy') {
        announceProfileMessage(t('browserProfiles.busy'));
        return;
      }
      if (outcome !== 'switched') return;
      if (id === GUEST_PROFILE_ID) return;
      const profile = useProfilesStore.getState().profiles.find((p) => p.id === id);
      if (profile) announceProfileMessage(t('browserProfiles.switched', { name: profileDisplayName(profile, defaultName) }));
    },
    [defaultName, t],
  );

  const startGuest = useCallback(async () => {
    const outcome = await enterGuest();
    if (outcome === 'busy') announceProfileMessage(t('browserProfiles.busy'));
    else if (outcome === 'started') announceProfileMessage(t('browserProfiles.guestStarted'));
  }, [t]);

  const leaveGuest = useCallback(async () => {
    const outcome = await exitGuest();
    if (outcome === 'busy') announceProfileMessage(t('browserProfiles.busy'));
    else if (outcome === 'ended') announceProfileMessage(t('browserProfiles.guestEnded'));
  }, [t]);

  return { defaultName, displayName, switchTo, startGuest, leaveGuest };
}
