import { memo, useCallback, useEffect, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { getV2Engine } from '@/downloads/v2';
import { checkMirrorInput, MAX_MIRRORS, type MirrorInput } from '@/downloads/v2/sources';
import { useTranslation } from '@/localization';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/**
 * Download details (#347): this file download's mirrors — other links to the same file. Adding or removing one is
 * saved with the download at once; a running download restarts its transfer from the bytes on disk, and the engine
 * uses a mirror only after it proved to be the same file (same length and first 64 KB).
 */
export const DownloadMirrorsSection = memo(function DownloadMirrorsSection({ downloadId }: { downloadId: string }) {
  const { t } = useTranslation();
  const engine = getV2Engine();
  const available = typeof engine?.setDownloadMirrors === 'function' && typeof engine?.getDownloadMirrors === 'function';
  const [mirrors, setMirrors] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!available) {
      return undefined;
    }
    let live = true;
    engine!.getDownloadMirrors!(downloadId)
      .then((list) => {
        if (live) setMirrors(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [available, downloadId, engine]);

  const messageFor = useCallback(
    (result: Extract<MirrorInput, { ok: false }>) => {
      switch (result.reason) {
        case 'private':
          return t('downloadSources.mirrorPrivate');
        case 'same':
          return t('downloadSources.mirrorSame');
        case 'duplicate':
          return t('downloadSources.mirrorDuplicate');
        case 'limit':
          return t('downloadSources.mirrorLimit', { count: MAX_MIRRORS });
        default:
          return t('downloadSources.mirrorInvalid');
      }
    },
    [t],
  );

  const save = useCallback(
    async (next: string[]) => {
      setBusy(true);
      try {
        setMirrors(await engine!.setDownloadMirrors!(downloadId, next));
        return true;
      } catch {
        setError(t('downloadSources.mirrorFailed'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [downloadId, engine, t],
  );

  const onAdd = useCallback(async () => {
    const checked = checkMirrorInput(draft, null, mirrors);
    if (!checked.ok) {
      setError(messageFor(checked));
      return;
    }
    if (await save([...mirrors, checked.url])) {
      setDraft('');
      setAdding(false);
      setError(null);
    }
  }, [draft, messageFor, mirrors, save]);

  if (!available) {
    return null;
  }
  return (
    <Box mt={8} gap={8} testID="download-details-mirrors">
      <Box gap={4}>
        <Text variant="body">{t('downloadSources.mirrorsTitle')}</Text>
        <Text variant="caption" color="textSecondary">
          {t('downloadSources.mirrorsHint')}
        </Text>
      </Box>
      {mirrors.map((mirror) => (
        <Box key={mirror} row style={{ alignItems: 'center', gap: 8 }}>
          <Box flex={1}>
            <Text variant="body" numberOfLines={1}>
              {hostOf(mirror)}
            </Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {mirror}
            </Text>
          </Box>
          <Button
            title={t('downloadSources.mirrorRemove')}
            variant="ghost"
            size="small"
            disabled={busy}
            onPress={() => {
              void save(mirrors.filter((m) => m !== mirror));
            }}
            accessibilityLabel={t('downloadSources.mirrorRemoveA11y', { host: hostOf(mirror) })}
            testID="download-details-mirror-remove"
          />
        </Box>
      ))}
      {adding ? (
        <Box gap={8}>
          <TextField
            label={t('downloadSources.mirrorAdd')}
            placeholder={t('downloadSources.mirrorPlaceholder')}
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              setError(null);
            }}
            error={error ?? undefined}
            disabled={busy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            testID="download-details-mirror-input"
          />
          <Box row style={{ gap: 8 }}>
            <Button
              title={t('downloadSources.mirrorSave')}
              variant="primary"
              size="small"
              loading={busy}
              onPress={() => {
                void onAdd();
              }}
              testID="download-details-mirror-save"
            />
            <Button
              title={t('downloadSources.mirrorCancel')}
              variant="ghost"
              size="small"
              disabled={busy}
              onPress={() => {
                setAdding(false);
                setDraft('');
                setError(null);
              }}
            />
          </Box>
        </Box>
      ) : mirrors.length < MAX_MIRRORS ? (
        <Button
          title={t('downloadSources.mirrorAdd')}
          variant="outline"
          size="small"
          leftIcon="plus"
          onPress={() => setAdding(true)}
          testID="download-details-mirror-add"
        />
      ) : null}
      {!adding && error ? (
        <Text variant="caption" color="error">
          {error}
        </Text>
      ) : null}
    </Box>
  );
});
