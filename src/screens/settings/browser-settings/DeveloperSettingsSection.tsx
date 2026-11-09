import { memo, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid, View } from 'react-native';
import * as Crypto from 'expo-crypto';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { Switch } from '@/components/inputs/Switch';
import { TextField } from '@/components/inputs/TextField';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { matchPatternSource, parseUserScriptHeader, type UserScript } from '@/browser/devtools/devtools-core';
import {
  deleteUserScript,
  isRemoteDebugging,
  saveUserScript,
  setRemoteDebugging,
  useDevtoolsVersion,
  useUserScripts,
} from '@/browser/devtools/devtools.service';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';
import { importTextFile } from '@/utils/text-file-export';

import { SettingsRow, SettingsSection } from '../components';

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.LONG);
  AccessibilityInfo.announceForAccessibility(message);
}

/** B19 — Browser settings → Developer: Developer tools (off by default), remote debugging, user scripts. */
export const DeveloperSettingsSection = memo(function DeveloperSettingsSection() {
  const { t } = useTranslation();
  useDevtoolsVersion();
  const update = useSettingsStore((s) => s.updateSetting);
  const on = useSettingsStore((s) => s.devTools === true);
  const scripts = useUserScripts();
  const [warn, setWarn] = useState(false);
  const [sheet, setSheet] = useState(false);
  const remote = isRemoteDebugging();

  return (
    <SettingsSection testID="browser-settings-developer" title={t('browserDevtools.section')} icon="code-tags">
      <SettingsRow
        title={t('browserDevtools.enable')}
        description={t('browserDevtools.enableHint')}
        icon="code-tags"
        trailing={
          <Switch
            value={on}
            onValueChange={(next) => update('devTools', next)}
            accessibilityLabel={t('browserDevtools.enable')}
            accessibilityHint={t('browserDevtools.enableHint')}
            testID="browser-settings-devtools"
          />
        }
      />
      {on ? (
        <>
          <SettingsRow
            title={t('browserDevtools.remote')}
            description={t('browserDevtools.remoteHint')}
            icon="usb"
            trailing={
              <Switch
                value={remote}
                onValueChange={(next) => (next ? setWarn(true) : void setRemoteDebugging(false))}
                accessibilityLabel={t('browserDevtools.remote')}
                accessibilityHint={t('browserDevtools.remoteHint')}
                testID="browser-settings-remote-debugging"
              />
            }
          />
          <SettingsRow
            title={t('browserDevtools.userScripts')}
            description={t('browserDevtools.userScriptsHint')}
            icon="script-text-outline"
            value={String(scripts.length)}
            onPress={() => setSheet(true)}
            showDivider={false}
            testID="browser-settings-user-scripts"
          />
        </>
      ) : null}
      <ConfirmModal
        visible={warn}
        variant="warning"
        title={t('browserDevtools.remoteWarnTitle')}
        message={t('browserDevtools.remoteWarnMessage')}
        confirmLabel={t('browserDevtools.remoteTurnOn')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setWarn(false);
          void setRemoteDebugging(true);
        }}
        onCancel={() => setWarn(false)}
        testID="browser-settings-remote-debugging-warning"
      />
      <UserScriptsSheet visible={sheet} onClose={() => setSheet(false)} />
    </SettingsSection>
  );
});

const blank = (): UserScript => ({
  id: Crypto.randomUUID(),
  name: '',
  code: '',
  matches: [],
  runAt: 'end',
  enabled: true,
  allowIncognito: false,
});

/** #199: the list, a plain editor, and import of a `.user.js` file (its header read as text; nothing downloaded). */
const UserScriptsSheet = memo(function UserScriptsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, rtl } = useTranslation();
  const scripts = useUserScripts();
  const [editing, setEditing] = useState<UserScript | null>(null);
  const [matchesText, setMatchesText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const edit = (script: UserScript) => {
    setEditing(script);
    setMatchesText(script.matches.join('\n'));
    setError(undefined);
  };

  const importFile = async () => {
    const picked = await importTextFile(['text/javascript', 'application/javascript', 'application/x-javascript', 'text/plain', '*/*'], 500_000);
    if (picked.status !== 'picked') {
      if (picked.status !== 'cancelled') notify(t('browserDevtools.scriptImportFailed'));
      return;
    }
    const header = parseUserScriptHeader(picked.text);
    edit({ ...blank(), name: header.name || t('browserDevtools.untitled'), code: picked.text, matches: header.matches, runAt: header.runAt });
    notify(t('browserDevtools.scriptImported', { name: header.name || t('browserDevtools.untitled') }));
    if (header.ignored > 0) notify(t('browserDevtools.scriptImportIgnored', { count: header.ignored }));
  };

  const save = async () => {
    if (!editing) return;
    const matches = matchesText.split('\n').map((m) => m.trim()).filter((m) => m && matchPatternSource(m) != null).slice(0, 20);
    if (!editing.name.trim() || matches.length === 0 || !editing.code.trim()) {
      setError(t('browserDevtools.scriptInvalid'));
      return;
    }
    await saveUserScript({ ...editing, name: editing.name.trim(), matches });
    setEditing(null);
  };

  if (editing) {
    return (
      <>
        <SheetFrame
          visible={visible && !confirmDelete}
          title={editing.name || t('browserDevtools.scriptAdd')}
          onClose={() => setEditing(null)}
          testID="user-script-editor"
          footer={
            <View style={{ flexDirection: rtl.rowDirection, gap: 8, flexWrap: 'wrap' }}>
              <Button title={t('browserDevtools.scriptSave')} onPress={() => void save()} testID="user-script-save" />
              {scripts.some((s) => s.id === editing.id) ? (
                <Button title={t('browserDevtools.scriptDelete')} variant="outline" onPress={() => setConfirmDelete(true)} />
              ) : null}
            </View>
          }>
          <View style={{ gap: 8 }}>
            <TextField label={t('browserDevtools.scriptName')} value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} />
            <TextField
              label={t('browserDevtools.scriptMatches')}
              value={matchesText}
              onChangeText={setMatchesText}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Toggle label={t('browserDevtools.scriptRunStart')} value={editing.runAt === 'start'} onChange={(v) => setEditing({ ...editing, runAt: v ? 'start' : 'end' })} />
            <Toggle label={t('browserDevtools.scriptEnabled')} value={editing.enabled} onChange={(v) => setEditing({ ...editing, enabled: v })} />
            <Toggle label={t('browserDevtools.scriptIncognito')} value={editing.allowIncognito} onChange={(v) => setEditing({ ...editing, allowIncognito: v })} />
            <TextField
              label={t('browserDevtools.scriptCode')}
              value={editing.code}
              onChangeText={(code) => setEditing({ ...editing, code })}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              style={{ fontFamily: 'monospace', minHeight: 160, textAlign: 'left', writingDirection: 'ltr' }}
              error={error}
            />
          </View>
        </SheetFrame>
        <ConfirmModal
          visible={visible && confirmDelete}
          variant="delete"
          title={t('browserDevtools.scriptDeleteTitle', { name: editing.name })}
          message=""
          confirmLabel={t('browserDevtools.scriptDelete')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            setConfirmDelete(false);
            void deleteUserScript(editing.id);
            setEditing(null);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      </>
    );
  }

  return (
    <SheetFrame
      visible={visible}
      title={t('browserDevtools.userScripts')}
      onClose={onClose}
      testID="user-scripts-sheet"
      footer={
        <View style={{ flexDirection: rtl.rowDirection, gap: 8, flexWrap: 'wrap' }}>
          <Button title={t('browserDevtools.scriptAdd')} onPress={() => edit(blank())} testID="user-script-add" />
          <Button title={t('browserDevtools.scriptImport')} variant="outline" onPress={() => void importFile()} testID="user-script-import" />
        </View>
      }>
      {scripts.length === 0 ? (
        <Text variant="bodySmall" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
          {t('browserDevtools.scriptsEmpty')}
        </Text>
      ) : (
        scripts.map((script) => (
          <Pressable
            key={script.id}
            accessibilityRole="button"
            onPress={() => edit(script)}
            style={{ minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
            <Icon name={script.enabled ? 'script-text-outline' : 'script-text-key-outline'} size={20} color="secondary" />
            <View style={{ flex: 1 }}>
              <Text variant="body" numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
                {script.name}
              </Text>
              <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ writingDirection: 'ltr' }}>
                {script.matches.join('  ')}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </SheetFrame>
  );
});

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { rtl } = useTranslation();
  return (
    <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', minHeight: 48, gap: 8 }}>
      <Text variant="body" style={{ flex: 1, textAlign: rtl.textAlign }}>
        {label}
      </Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}
