import { memo, useEffect, useMemo, useState } from 'react';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { GUEST_PROFILE } from '@/browser/profiles/profile-registry';
import { useProfilesStore } from '@/browser/profiles/profile-service';
import { useProfileActions } from '@/browser/profiles/use-profile-actions';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';

import { profileSwitcherRequests } from './profile-switcher-requests';

/**
 * B20 #207 Switch profile: from the browser menu, one tap to another profile, into guest mode or out of it, or to
 * Browser settings to manage profiles. In guest mode it offers only "Leave guest mode".
 */
export const ProfileSwitcherHost = memo(function ProfileSwitcherHost() {
  const { t } = useTranslation();
  const profiles = useProfilesStore((s) => s.profiles);
  const activeId = useProfilesStore((s) => s.activeId);
  const appLockOn = useAppLockStore((s) => s.isEnabled);
  const { displayName, switchTo, startGuest, leaveGuest } = useProfileActions();
  const [visible, setVisible] = useState(false);
  const [confirmGuest, setConfirmGuest] = useState(false);

  useEffect(() => profileSwitcherRequests.subscribe(() => setVisible(true)), []);

  const actions = useMemo(() => {
    if (activeId === GUEST_PROFILE) {
      return [
        {
          id: 'leave-guest',
          label: t('browserProfiles.leaveGuest'),
          icon: 'exit-run',
          onPress: () => {
            setVisible(false);
            void leaveGuest();
          },
        },
      ];
    }
    return [
      ...profiles.map((profile) => ({
        id: `profile-${profile.id}`,
        label: profile.id === activeId ? `${displayName(profile)} · ${t('browserProfiles.inUse')}` : displayName(profile),
        icon: profile.id === activeId ? 'account-check' : 'account-outline',
        onPress: () => {
          setVisible(false);
          if (profile.id !== activeId) void switchTo(profile.id);
        },
      })),
      {
        id: 'guest',
        label: t('browserProfiles.startGuest'),
        icon: 'account-question-outline',
        onPress: () => {
          setVisible(false);
          setConfirmGuest(true);
        },
      },
      {
        id: 'manage',
        label: t('browserProfiles.manageProfiles'),
        icon: 'cog-outline',
        onPress: () => {
          setVisible(false);
          navigation.push(routePaths.browserSettings);
        },
      },
    ];
  }, [activeId, displayName, leaveGuest, profiles, switchTo, t]);

  return (
    <>
      <ActionSheetModal
        visible={visible}
        title={t('browserProfiles.switcherTitle')}
        actions={actions}
        cancelLabel={t('common.cancel')}
        onClose={() => setVisible(false)}
        testID="browser-profile-switcher"
      />
      <ConfirmModal
        visible={confirmGuest}
        variant="warning"
        title={t('browserProfiles.startGuestTitle')}
        message={
          appLockOn
            ? `${t('browserProfiles.startGuestMessage')} ${t('browserProfiles.startGuestLockNote')}`
            : t('browserProfiles.startGuestMessage')
        }
        confirmLabel={t('browserProfiles.startGuest')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setConfirmGuest(false);
          void startGuest();
        }}
        onCancel={() => setConfirmGuest(false)}
        testID="browser-switcher-guest-confirm"
      />
    </>
  );
});
