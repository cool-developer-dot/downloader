import { useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View, type ListRenderItem } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { ds, DsButton, DsCard, DsChip, DsChipRow, DsHeader, DsRow, DsScreen, DsSectionLabel, DsText } from '@/design';
import {
  batchRename,
  canApplyRename,
  ILLEGAL_NAME_CHARACTERS,
  MAX_DIGITS,
  MIN_DIGITS,
  type RenameMode,
  type RenameResult,
} from '@/files/rename/batch-rename';
import { createClashResolver, findClash, keepBothName, type ClashChoice } from '@/files/rename/name-clash';
import { deleteForReplace, renameFileTo } from '@/files/rename/rename-runtime';
import { fileLabel } from '@/files/ui/file-fields';
import { folderPath, listFolder, type FileEntry } from '@/files/ui/files-source';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { navigation } from '@/navigation';

import { announce } from './announce';
import { ListCardCell } from './components/ListCardCell';
import { NameClashDialog, useNameClash } from './components/NameClashDialog';
import { PROBLEM_KEYS } from './components/RenameFileDialog';
import { listAllFiles } from './hooks/use-files-data';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';

type ModeKind = RenameMode['kind'];
type CaseTo = Extract<RenameMode, { kind: 'case' }>['to'];

const MODE_LABELS: Record<ModeKind, TranslationKey> = {
  replace: 'fileManager.modeReplace',
  affix: 'fileManager.modeAffix',
  number: 'fileManager.modeNumber',
  case: 'fileManager.modeCase',
};
const CASE_LABELS: Record<CaseTo, TranslationKey> = {
  upper: 'fileManager.caseUpper',
  lower: 'fileManager.caseLower',
  title: 'fileManager.caseTitle',
  sentence: 'fileManager.caseSentence',
};

type Failure = { name: string; reason: 'skipped' | 'failed' };

/**
 * Files F5 · #793 Batch rename, #794 Auto numbering (`/files/batch-rename?ids=`): from the selection bar's More →
 * Rename. Four modes — Replace text, Prefix / suffix, Number them (start, 1–4 digits, before or after), Change case — a
 * live old → new preview with each problem in red, and Rename only while there is none. It renames one file at a time
 * with the existing rename, asks Keep both / Replace / Skip on a clash (with "Do this for all"), and lists what was
 * not renamed, and why, at the end.
 */
export const BatchRenameScreen = memo(function BatchRenameScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const settingsAction = useFilesSettingsAction();
  const idsParam = useLocalSearchParams<{ ids?: string | string[] }>().ids;
  const ids = useMemo(() => (Array.isArray(idsParam) ? idsParam.join(',') : (idsParam ?? '')).split(',').filter(Boolean), [idsParam]);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [kind, setKind] = useState<ModeKind>('replace');
  const [find, setFind] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [text, setText] = useState('');
  const [start, setStart] = useState('1');
  const [digits, setDigits] = useState(2);
  const [position, setPosition] = useState<'before' | 'after'>('after');
  const [caseTo, setCaseTo] = useState<CaseTo>('title');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<Failure[] | null>(null);
  const clash = useNameClash();

  useEffect(() => {
    let live = true;
    void listAllFiles()
      .catch(() => [] as FileEntry[])
      .then((all) => {
        if (!live) return;
        const byId = new Map(all.map((file) => [file.id, file] as const));
        setFiles(ids.map((id) => byId.get(id)).filter((file): file is FileEntry => Boolean(file)));
      });
    return () => {
      live = false;
    };
  }, [ids]);

  const mode = useMemo<RenameMode>(() => {
    switch (kind) {
      case 'replace':
        return { kind, find, replaceWith, matchCase };
      case 'affix':
        return { kind, prefix, suffix };
      case 'number':
        return { kind, start: Number.parseInt(start, 10) || 0, digits, position, text };
      default:
        return { kind: 'case', to: caseTo };
    }
  }, [caseTo, digits, find, kind, matchCase, position, prefix, replaceWith, start, suffix, text]);

  const results = useMemo(() => (files ? batchRename(files.map((file) => fileLabel(file)), mode) : []), [files, mode]);
  const canApply = canApplyRename(results) && !progress;

  const apply = useCallback(async () => {
    if (!files) return;
    const failed: Failure[] = [];
    // "Do this for all" (#797): each clash asks until an answer is for all.
    let resolve: (() => Promise<ClashChoice>) | null = null;
    let pendingName = '';
    let pendingFolder = '';
    let renamed = 0;
    const batchIds = new Set(files.map((file) => file.id));
    const total = results.filter((result) => result.to !== result.from).length;
    let done = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      let next = results[index]!.to;
      if (next === fileLabel(file)) continue;
      done += 1;
      setProgress({ done, total });
      try {
        // A clash with a file of the same folder that is not being renamed in this batch.
        const listing = await listFolder(file.folderId);
        const others = listing.files.filter((other) => !batchIds.has(other.id));
        const clashing = findClash(next, others.map((other) => fileLabel(other)));
        if (clashing) {
          pendingName = next;
          const path = file.folderId ? await folderPath(file.folderId) : [];
          pendingFolder = path[path.length - 1]?.name ?? t('filesTab.title');
          resolve ??= createClashResolver(() => clash.ask(pendingName, pendingFolder, true));
          const choice = await resolve();
          if (choice === 'skip') {
            failed.push({ name: fileLabel(file), reason: 'skipped' });
            continue;
          }
          if (choice === 'keep-both') {
            next = keepBothName(next, others.map((other) => fileLabel(other)));
          } else {
            const victim = others.find((other) => fileLabel(other).toLocaleLowerCase() === clashing.toLocaleLowerCase());
            if (victim) await deleteForReplace(victim.id);
          }
        }
        await renameFileTo(file.id, next);
        renamed += 1;
      } catch {
        failed.push({ name: fileLabel(file), reason: 'failed' });
      }
    }
    setProgress(null);
    announce(t('fileManager.renamedCount', { count: renamed }));
    if (failed.length === 0) {
      navigation.back();
    } else {
      setFailures(failed);
    }
  }, [clash, files, results, t]);

  const problemText = useCallback(
    (problem: NonNullable<RenameResult['problem']>) => t(PROBLEM_KEYS[problem], { characters: ILLEGAL_NAME_CHARACTERS.join(' ') }),
    [t],
  );

  const renderResult = useCallback<ListRenderItem<RenameResult>>(
    ({ item }) => (
      <View
        accessible
        accessibilityLabel={[t('fileManager.renameArrowA11y', { from: item.from, to: item.to }), item.problem ? problemText(item.problem) : null]
          .filter(Boolean)
          .join('. ')}
        style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, gap: 2 }}>
        <DsText variant="rowSub" numberOfLines={1}>
          {item.from}
        </DsText>
        <DsText variant="rowTitle" color={item.problem ? 'error' : 'textPrimary'} numberOfLines={2}>
          {`→ ${item.to}`}
        </DsText>
        {item.problem ? (
          <DsText variant="rowSub" color="error">
            {problemText(item.problem)}
          </DsText>
        ) : null}
      </View>
    ),
    [problemText, t, theme.colors.divider],
  );

  if (failures) {
    return (
      <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-batch-rename-result">
        <FlatList
          data={failures}
          keyExtractor={(failure, index) => `${index}:${failure.name}`}
          renderItem={({ item: failure, index }) => (
            <ListCardCell first={index === 0} last={index === failures.length - 1}>
              <DsRow
                icon="alert-triangle"
                title={failure.name}
                subtitle={failure.reason === 'skipped' ? t('fileManager.reasonSkipped') : t('fileManager.reasonFailed')}
                trailing="none"
              />
            </ListCardCell>
          )}
          ListHeaderComponent={
            <View style={{ paddingBottom: ds.space.stack }}>
              <DsHeader title={t('fileManager.renameFailures')} onBack={() => navigation.back()} action={settingsAction} />
            </View>
          }
          ListFooterComponent={
            <View style={{ paddingTop: ds.space.stack }}>
              <DsButton label={t('fileManager.renameDone')} onPress={() => navigation.back()} fullWidth />
            </View>
          }
          contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 24 }}
          testID="files-batch-rename-failures"
        />
      </DsScreen>
    );
  }

  const header = (
    <View style={{ gap: ds.space.stack, paddingBottom: ds.space.stack }}>
      <DsHeader title={t('fileManager.renameTitle', { count: files?.length ?? ids.length })} onBack={() => navigation.back()} action={settingsAction} />
      <DsChipRow>
        {(Object.keys(MODE_LABELS) as ModeKind[]).map((value) => (
          <DsChip key={value} label={t(MODE_LABELS[value])} selected={kind === value} onPress={() => setKind(value)} testID={`files-rename-mode-${value}`} />
        ))}
      </DsChipRow>
      <DsCard>
        <View style={{ gap: 10 }}>
          {kind === 'replace' ? (
            <>
              <TextField label={t('fileManager.renameFind')} value={find} onChangeText={setFind} autoCapitalize="none" testID="files-rename-find" />
              <TextField label={t('fileManager.renameReplaceWith')} value={replaceWith} onChangeText={setReplaceWith} autoCapitalize="none" testID="files-rename-replace" />
              <DsChipRow scroll={false}>
                <DsChip label={t('fileManager.renameMatchCase')} selected={matchCase} onPress={() => setMatchCase((value) => !value)} />
              </DsChipRow>
            </>
          ) : kind === 'affix' ? (
            <>
              <TextField label={t('fileManager.renamePrefix')} value={prefix} onChangeText={setPrefix} testID="files-rename-prefix" />
              <TextField label={t('fileManager.renameSuffix')} value={suffix} onChangeText={setSuffix} testID="files-rename-suffix" />
            </>
          ) : kind === 'number' ? (
            <>
              <TextField label={t('fileManager.renameNewName')} value={text} onChangeText={setText} testID="files-rename-text" />
              <TextField label={t('fileManager.renameStart')} value={start} onChangeText={(value) => setStart(value.replace(/[^0-9]/g, ''))} keyboardType="number-pad" testID="files-rename-start" />
              <DsChipRow scroll={false}>
                {Array.from({ length: MAX_DIGITS - MIN_DIGITS + 1 }, (_, i) => i + MIN_DIGITS).map((value) => (
                  <DsChip key={value} label={t('fileManager.renameDigits', { count: value })} selected={digits === value} onPress={() => setDigits(value)} />
                ))}
              </DsChipRow>
              <DsChipRow scroll={false}>
                <DsChip label={t('fileManager.renameBefore')} selected={position === 'before'} onPress={() => setPosition('before')} />
                <DsChip label={t('fileManager.renameAfter')} selected={position === 'after'} onPress={() => setPosition('after')} />
              </DsChipRow>
            </>
          ) : (
            <DsChipRow scroll={false}>
              {(Object.keys(CASE_LABELS) as CaseTo[]).map((value) => (
                <DsChip key={value} label={t(CASE_LABELS[value])} selected={caseTo === value} onPress={() => setCaseTo(value)} />
              ))}
            </DsChipRow>
          )}
        </View>
      </DsCard>
      <DsSectionLabel>{t('fileManager.renamePreview')}</DsSectionLabel>
    </View>
  );

  return (
    <DsScreen
      scroll={false}
      edges={['top', 'bottom']}
      testID="files-batch-rename"
      footer={
        progress ? (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <DsText variant="body" accessibilityLiveRegion="polite">
              {t('fileManager.renaming', { done: progress.done, total: progress.total })}
            </DsText>
          </View>
        ) : (
          <DsButton
            label={t('fileManager.renameApply', { count: results.filter((result) => result.to !== result.from).length })}
            onPress={() => void apply()}
            disabled={!canApply}
            fullWidth
            testID="files-batch-rename-apply"
          />
        )
      }>
      <FlatList
        data={results}
        keyExtractor={(result, index) => `${index}:${result.from}`}
        renderItem={renderResult}
        ListHeaderComponent={header}
        ListEmptyComponent={files === null ? <ActivityIndicator color={theme.colors.primary} /> : null}
        contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      />
      <NameClashDialog {...clash.dialogProps} />
    </DsScreen>
  );
});
