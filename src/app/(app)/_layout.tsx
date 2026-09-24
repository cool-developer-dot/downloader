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
import { ReviewPromptHost } from '@/review';
import { AppLockGate } from '@/security/app-lock';

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
  const downloadSettingsHeaderOptions = useMemo(
    () => createStackHeaderOptions(t('nav.downloadSettings'), theme),
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
  const historyHeaderOptions = useMemo(
    () => createHiddenHeaderOptions(),
    [],
  );

  return (
    <ProtectedRouteGuard>
      <AppLockGate>
        <ReviewPromptHost />
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
            name={appStackRouteNames.history}
            options={historyHeaderOptions}
          />
          <Stack.Screen
            name={appStackRouteNames.watchHistory}
            options={createHiddenHeaderOptions()}
          />
          <Stack.Screen
            name={appStackRouteNames.bookmarks}
            options={createHiddenHeaderOptions()}
          />
          <Stack.Screen
            name={appStackRouteNames.favorites}
            options={createHiddenHeaderOptions()}
          />
          <Stack.Screen
            name={appStackRouteNames.downloadSettings}
            options={downloadSettingsHeaderOptions}
          />
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
            name={appStackRouteNames.downloadDetails}
            options={createHiddenHeaderOptions()}
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
      </AppLockGate>
    </ProtectedRouteGuard>
  );
}
