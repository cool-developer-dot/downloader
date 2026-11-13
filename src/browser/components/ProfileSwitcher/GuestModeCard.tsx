import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { GUEST_PROFILE } from '@/browser/profiles/profile-registry';
import { useProfilesStore } from '@/browser/profiles/profile-service';
import { useProfileActions } from '@/browser/profiles/use-profile-actions';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { ProfileAvatar } from './ProfileAvatar';

/** B20 #208: on the start page in guest mode — who is browsing, that nothing is kept, and the way out. */
export const GuestModeCard = memo(function GuestModeCard() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const guest = useProfilesStore((s) => s.activeId === GUEST_PROFILE);
  const switching = useProfilesStore((s) => s.switching);
  const { leaveGuest } = useProfileActions();
  if (!guest) return null;
  return (
    <Box
      testID="browser-guest-card"
      gap={12}
      style={{
        padding: 16,
        marginBottom: 20,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}>
      <Box row rtlRow center gap={12}>
        <ProfileAvatar name="" color="blue" guest size={40} />
        <Box flex={1} style={{ minWidth: 0 }}>
          <Text variant="label" accessibilityRole="header" style={{ textAlign: rtl.textAlign }}>
            {t('browserProfiles.guestBanner')}
          </Text>
          <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
            {t('browserProfiles.guestBannerHint')}
          </Text>
        </Box>
      </Box>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('browserProfiles.leaveGuest')}
        disabled={switching}
        accessibilityState={{ disabled: switching }}
        onPress={() => void leaveGuest()}
        testID="browser-guest-leave"
        style={{
          minHeight: 48,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.primary,
        }}>
        <Text variant="button" color="textOnPrimary">
          {t('browserProfiles.leaveGuest')}
        </Text>
      </Pressable>
    </Box>
  );
});
