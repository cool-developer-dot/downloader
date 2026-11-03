import { memo, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { Divider } from '@/components/common/Divider';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { ProfileAvatar } from '@/browser/components/ProfileSwitcher/ProfileAvatar';
import { announceProfileMessage } from '@/browser/profiles/profile-feedback';
import { DEFAULT_PROFILE, GUEST_PROFILE, MAX_PROFILES, type BrowserProfile } from '@/browser/profiles/profile-registry';
import {
  createProfile,
  deleteProfile,
  refreshSeparateSiteData,
  renameProfile,
  sweepOrphanWebProfiles,
  useProfilesStore,
} from '@/browser/profiles/profile-service';
import { useProfileActions } from '@/browser/profiles/use-profile-actions';
import { useTranslation } from '@/localization';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';

import { SettingsRow, SettingsSection } from '../components';
import { useSettingsTokens } from '../theme/settings-tokens';
import { ProfileNameSheet } from './ProfileNameSheet';

const ProfileRow = memo(function ProfileRow({
  profile,
  name,
  active,
  onPress,
}: {
  profile: BrowserProfile;
  name: string;
  active: boolean;
  onPress: () => void;
}) {
  const tokens = useSettingsTokens();
  const { t, rtl } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={active ? t('browserProfiles.profileA11y', { name }) : name}
      accessibilityHint={t('browserProfiles.profileOptionsA11y', { name })}
      testID={`browser-profile-row-${profile.id}`}
      style={{ minHeight: 56 }}>
      <Box row rtlRow center gap={14} py={10} style={{ minHeight: 56 }}>
        <ProfileAvatar name={name} color={profile.color} size={40} />
        <Box flex={1} style={{ minWidth: 0 }}>
          <Text variant="body" numberOfLines={1} style={{ color: tokens.textPrimary, textAlign: rtl.textAlign }}>
            {name}
          </Text>
          {active ? (
            <Text variant="caption" style={{ color: tokens.textSecondary, textAlign: rtl.textAlign }}>
              {t('browserProfiles.inUse')}
            </Text>
          ) : null}
        </Box>
        {active ? <Icon name="check-circle" size="sm" color="primary" /> : null}
        <Icon name="dots-vertical" size="sm" color="secondary" />
      </Box>
    </Pressable>
  );
});

/**
 * B20 — Browser settings → Profiles and guest mode: #206 Multiple profiles (add, rename, delete), #207 Switch profile,
 * #208 Guest mode. In guest mode only "Leave guest mode" shows: a guest can't see or change the owner's profiles.
 */
export const ProfilesSettingsSection = memo(function ProfilesSettingsSection() {
  const { t } = useTranslation();
  const profiles = useProfilesStore((s) => s.profiles);
  const activeId = useProfilesStore((s) => s.activeId);
  const switching = useProfilesStore((s) => s.switching);
  const separateSiteData = useProfilesStore((s) => s.separateSiteData);
  const appLockOn = useAppLockStore((s) => s.isEnabled);
  const { defaultName, displayName, switchTo, startGuest, leaveGuest } = useProfileActions();
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'rename'; id: string } | null>(null);
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmGuest, setConfirmGuest] = useState(false);
  const guest = activeId === GUEST_PROFILE;
  const atLimit = profiles.length >= MAX_PROFILES;

  useEffect(() => {
    void refreshSeparateSiteData();
    void sweepOrphanWebProfiles();
  }, []);

  const selected = profiles.find((p) => p.id === optionsFor) ?? null;
  const deletingProfile = profiles.find((p) => p.id === deleting) ?? null;
  const renaming = editor?.mode === 'rename' ? profiles.find((p) => p.id === editor.id) ?? null : null;

  const options = useMemo(() => {
    if (!selected) return [];
    const items = [];
    if (selected.id !== activeId) {
      items.push({
        id: 'switch',
        label: t('browserProfiles.switchTo'),
        icon: 'account-switch-outline',
        onPress: () => {
          setOptionsFor(null);
          void switchTo(selected.id);
        },
      });
    }
    items.push({
      id: 'rename',
      label: t('browserProfiles.rename'),
      icon: 'pencil-outline',
      onPress: () => {
        setOptionsFor(null);
        setEditor({ mode: 'rename', id: selected.id });
      },
    });
    if (selected.id !== DEFAULT_PROFILE && selected.id !== activeId) {
      items.push({
        id: 'delete',
        label: t('browserProfiles.deleteProfile'),
        icon: 'delete-outline',
        destructive: true,
        onPress: () => {
          setOptionsFor(null);
          setDeleting(selected.id);
        },
      });
    }
    return items;
  }, [activeId, selected, switchTo, t]);

  const submitName = (name: string) => {
    if (editor?.mode === 'create') {
      const outcome = createProfile(name, defaultName);
      if (outcome.ok) {
        setEditor(null);
        return null;
      }
      if (outcome.reason === 'limit') {
        announceProfileMessage(t('browserProfiles.limitReached', { count: MAX_PROFILES }));
        return 'limit' as const;
      }
      return outcome.reason;
    }
    if (editor?.mode === 'rename') {
      const outcome = renameProfile(editor.id, name, defaultName);
      if (outcome.ok) {
        setEditor(null);
        return null;
      }
      return outcome.reason;
    }
    return null;
  };

  const confirmDelete = async () => {
    const id = deleting;
    setDeleting(null);
    if (!id) return;
    const outcome = await deleteProfile(id);
    if (outcome === 'deleted') announceProfileMessage(t('browserProfiles.deleted'));
    else if (outcome === 'busy') announceProfileMessage(t('browserProfiles.busy'));
  };

  return (
    <SettingsSection
      testID="browser-settings-profiles"
      title={t('browserProfiles.section')}
      description={t('browserProfiles.sectionDescription')}
      icon="account-multiple-outline">
      {guest ? (
        <SettingsRow
          title={t('browserProfiles.leaveGuest')}
          description={t('browserProfiles.guestBannerHint')}
          icon="exit-run"
          onPress={switching ? undefined : () => void leaveGuest()}
          testID="browser-settings-leave-guest"
        />
      ) : (
        <View>
          <Text variant="caption" color="textSecondary" style={{ marginBottom: 4 }}>
            {t('browserProfiles.whatIsSeparate')}
          </Text>
          {separateSiteData ? null : (
            <Text variant="caption" color="warning" testID="browser-settings-profiles-shared" style={{ marginBottom: 4 }}>
              {t('browserProfiles.sharedSiteData')}
            </Text>
          )}
          {profiles.map((profile, index) => (
            <View key={profile.id}>
              {index > 0 ? <Divider /> : null}
              <ProfileRow
                profile={profile}
                name={displayName(profile)}
                active={profile.id === activeId}
                onPress={() => setOptionsFor(profile.id)}
              />
            </View>
          ))}
          <SettingsRow
            title={t('browserProfiles.addProfile')}
            description={atLimit ? t('browserProfiles.limitReached', { count: MAX_PROFILES }) : undefined}
            icon="account-plus-outline"
            onPress={atLimit || switching ? undefined : () => setEditor({ mode: 'create' })}
            testID="browser-settings-add-profile"
          />
          <SettingsRow
            title={t('browserProfiles.startGuest')}
            description={t('browserProfiles.guestModeHint')}
            icon="account-question-outline"
            showDivider={false}
            onPress={switching ? undefined : () => setConfirmGuest(true)}
            testID="browser-settings-start-guest"
          />
        </View>
      )}

      <ActionSheetModal
        visible={selected != null}
        title={selected ? displayName(selected) : undefined}
        actions={options}
        cancelLabel={t('common.cancel')}
        onClose={() => setOptionsFor(null)}
        testID="browser-profile-options"
      />
      <ProfileNameSheet
        visible={editor != null}
        mode={editor?.mode ?? 'create'}
        initialName={renaming ? displayName(renaming) : ''}
        onSubmit={submitName}
        onClose={() => setEditor(null)}
      />
      <ConfirmModal
        visible={deletingProfile != null}
        variant="delete"
        title={deletingProfile ? t('browserProfiles.deleteTitle', { name: displayName(deletingProfile) }) : ''}
        message={t('browserProfiles.deleteMessage')}
        confirmLabel={t('browserProfiles.deleteProfile')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
        testID="browser-profile-delete-confirm"
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
        testID="browser-profile-guest-confirm"
      />
    </SettingsSection>
  );
});
