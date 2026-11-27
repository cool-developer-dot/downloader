import { Stack } from 'expo-router';
import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import {
  appStackRouteNames,
  appStackScreenOptions,
  createContentStyleOptions,
  createHiddenHeaderOptions,
  createStackHeaderOptions,
  ProtectedRouteGuard,
} from '@/navigation';
import { IncomingMediaHost } from '@/player/IncomingMediaHost';
import { PlayerSessionHost } from '@/player/session-host';
import { DownloadSignInHost } from '@/screens/downloads/components/DownloadSignInHost';
import { ReviewPromptHost } from '@/review';
import { OrganizeHosts } from '@/screens/downloads/components/OrganizeHosts';
import { MiniPlayerOverlay } from '@/screens/player/mini';
import { ClipboardLinkBanner } from '@/browser/components/ClipboardLinkBanner';
import { AppLockGate } from '@/security/app-lock';
import { SecurityHost } from '@/screens/settings/security/SecurityHost';
import { DeleteUndoHost } from '@/screens/files/components/DeleteUndoHost';
import { TourAccessibilityScope, TourHost } from '@/tour';
// Files F2 / F7 (Faran's F17): the File Manager's own settings keys join every backup.
import '@/files/ui/files-backup-keys';

export default function AppLayout() {
  const theme = useTheme();
  const { t } = useTranslation();

  const screenOptions = useMemo(
    () => ({
      ...appStackScreenOptions,
      ...createContentStyleOptions(theme.colors.background),
    }),
    [theme.colors.background],
  );

  const aboutHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.about'), theme),
    [t, theme],
  );
  const supportHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.support'), theme),
    [t, theme],
  );
  const reportProblemHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.reportProblem'), theme),
    [t, theme],
  );
  const appLockSetupHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.appLockSetup'), theme),
    [t, theme],
  );
  const appLockDisableHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.appLockDisable'), theme),
    [t, theme],
  );
  const appLockChangePinHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.appLockChangePin'), theme),
    [t, theme],
  );
  const appLockRotateRecoveryHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.appLockRotateRecovery'), theme),
    [t, theme],
  );
  const storageHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.storage'), theme),
    [t, theme],
  );
  const privacyHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.privacy'), theme),
    [t, theme],
  );
  const termsHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.terms'), theme),
    [t, theme],
  );

  return (
    <ProtectedRouteGuard>
      <AppLockGate>
        <TourAccessibilityScope>
          {/* #299: "Sign in to download" for a server that asks for a user name and password. */}
          <DownloadSignInHost />
          <ReviewPromptHost />
          {/* The one player session, shared by the Player screen and the mini player (outlives the Player screen). */}
          <PlayerSessionHost />
          <IncomingMediaHost />
          {/* Files F10: Block screenshots for the whole app, and locked folders lock again with the app. */}
          <SecurityHost />
          <Stack screenOptions={screenOptions}>
            <Stack.Screen
              name={appStackRouteNames.tabs}
              options={createHiddenHeaderOptions()}
            />
            <Stack.Screen name={appStackRouteNames.about} options={aboutHeaderOptions} />
            <Stack.Screen
              name={appStackRouteNames.support}
              options={supportHeaderOptions}
            />
            <Stack.Screen
              name={appStackRouteNames.reportProblem}
              options={reportProblemHeaderOptions}
            />
            <Stack.Screen
              name={appStackRouteNames.privacy}
              options={privacyHeaderOptions}
            />
            <Stack.Screen
              name={appStackRouteNames.terms}
              options={termsHeaderOptions}
            />
            <Stack.Screen
              name={appStackRouteNames.watchHistory}
              options={createHiddenHeaderOptions()}
            />
            {/* P7: the user's playlists, and one playlist (their own DsHeader). */}
            <Stack.Screen name={appStackRouteNames.playlists} options={createHiddenHeaderOptions()} />
            <Stack.Screen name={appStackRouteNames.playlist} options={createHiddenHeaderOptions()} />
            <Stack.Screen
              name={appStackRouteNames.appLockSetup}
              options={appLockSetupHeaderOptions}
            />
            <Stack.Screen
              name={appStackRouteNames.appLockDisable}
              options={appLockDisableHeaderOptions}
            />
            <Stack.Screen
              name={appStackRouteNames.appLockChangePin}
              options={appLockChangePinHeaderOptions}
            />
            <Stack.Screen
              name={appStackRouteNames.appLockRotateRecovery}
              options={appLockRotateRecoveryHeaderOptions}
            />
            <Stack.Screen
              name={appStackRouteNames.storage}
              options={storageHeaderOptions}
            />
            <Stack.Screen
              name={appStackRouteNames.player}
              options={{
                ...createHiddenHeaderOptions(),
                ...createContentStyleOptions(theme.colors.black),
                animation: 'fade',
              }}
            />
          </Stack>
          {/* Files F8: every delete's Confirm before delete and its "… · Undo" bar (outlives the screen it came from). */}
          <DeleteUndoHost />
          <OrganizeHosts />
          <MiniPlayerOverlay />
          <ClipboardLinkBanner />
        </TourAccessibilityScope>
        {/* The first-launch Browser tour, drawn over everything in the app window (tabs included). */}
        <TourHost />
      </AppLockGate>
    </ProtectedRouteGuard>
  );
}
