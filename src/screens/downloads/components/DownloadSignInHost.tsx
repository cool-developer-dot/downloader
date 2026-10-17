import { memo, useCallback, useEffect, useRef, useState } from 'react';

import type { DownloadCredentials } from '@modules/vidorax-media/src/VidoraMedia.types';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { PasswordField } from '@/components/inputs/PasswordField';
import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import {
  credentialsProblem,
  setDownloadSignInPrompt,
  signInHost,
  type CredentialsProblem,
  type SignInRequest,
} from '@/downloads/v2/download-auth';
import { useTranslation, type TranslationKey } from '@/localization';

type Pending = SignInRequest & { resolve: (answer: DownloadCredentials | null) => void };

const PROBLEM_KEYS: Record<CredentialsProblem, TranslationKey> = {
  USERNAME_REQUIRED: 'downloadSignIn.usernameRequired',
  USERNAME_COLON: 'downloadSignIn.usernameColon',
  TOO_LONG: 'downloadSignIn.tooLong',
  CONTROL_CHARACTERS: 'downloadSignIn.invalidCharacters',
};

/**
 * Authentication Support (#299): the app-wide "Sign in to download" dialog. What the user types stays in this
 * component's state only; it is handed to the one waiting call and cleared as soon as the dialog closes.
 */
export const DownloadSignInHost = memo(function DownloadSignInHost() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<CredentialsProblem | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const close = useCallback((answer: DownloadCredentials | null) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setUsername('');
    setPassword('');
    setProblem(null);
    current?.resolve(answer);
  }, []);

  useEffect(() => {
    setDownloadSignInPrompt(
      (request) =>
        new Promise<DownloadCredentials | null>((resolve) => {
          // One dialog at a time: a second request while one is open is answered "no".
          if (pendingRef.current) {
            resolve(null);
            return;
          }
          const next: Pending = { ...request, resolve };
          pendingRef.current = next;
          setPending(next);
        }),
    );
    return () => {
      setDownloadSignInPrompt(null);
      pendingRef.current?.resolve(null);
      pendingRef.current = null;
    };
  }, []);

  const submit = useCallback(() => {
    const found = credentialsProblem(username, password);
    if (found) {
      setProblem(found);
      return;
    }
    close({ username, password });
  }, [close, password, username]);

  if (!pending) {
    return null;
  }

  const host = signInHost(pending.origin);
  return (
    <AppModal
      visible
      title={t('downloadSignIn.title')}
      subtitle={t('downloadSignIn.message', { host })}
      onClose={() => close(null)}
      testID="download-sign-in">
      <Box gap={12}>
        {pending.realm ? (
          <Text variant="caption" color="textSecondary" numberOfLines={2}>
            {t('downloadSignIn.realm', { realm: pending.realm })}
          </Text>
        ) : null}
        <TextField
          label={t('downloadSignIn.username')}
          value={username}
          onChangeText={(value) => {
            setUsername(value);
            setProblem(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          maxLength={256}
          error={problem && problem !== 'TOO_LONG' ? t(PROBLEM_KEYS[problem]) : undefined}
          testID="download-sign-in-username"
        />
        <PasswordField
          label={t('downloadSignIn.password')}
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setProblem(null);
          }}
          maxLength={256}
          error={problem === 'TOO_LONG' ? t(PROBLEM_KEYS[problem]) : undefined}
          onSubmitEditing={submit}
          testID="download-sign-in-password"
        />
        <Text variant="caption" color="textSecondary">
          {t('downloadSignIn.privacy')}
        </Text>
        <Box row gap={12}>
          <Box flex={1}>
            <Button
              title={t('common.cancel')}
              variant="outline"
              onPress={() => close(null)}
              fullWidth
              testID="download-sign-in-cancel"
            />
          </Box>
          <Box flex={1}>
            <Button title={t('downloadSignIn.submit')} onPress={submit} fullWidth testID="download-sign-in-submit" />
          </Box>
        </Box>
      </Box>
    </AppModal>
  );
});
