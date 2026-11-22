import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import type { SavedComments } from '@/downloads/comments/comments-core';
import { deleteSavedComments, fetchAndSaveComments, isDirectMediaSource, readSavedComments } from '@/downloads/comments/comments-store';
import { useTranslation } from '@/localization';
import { formatDownloadDate } from '@/screens/downloads/utils/download-format';

const PREVIEW_COUNT = 5;

/**
 * Download details → comments (#380): "Save comments" reads the video page's public comments (schema.org data, or
 * Reddit's public view) and keeps them on the phone with the video; they are listed here and deleted with it.
 */
export const DownloadCommentsSection = memo(function DownloadCommentsSection({ id, sourceUrl }: { id: string; sourceUrl: string | null | undefined }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<SavedComments | null>(() => readSavedComments(id));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const web = sourceUrl && /^https?:\/\//i.test(sourceUrl) && !isDirectMediaSource(sourceUrl) ? sourceUrl : null;

  const fetchComments = useCallback(async () => {
    if (!web) return;
    setBusy(true);
    setNotice(null);
    const outcome = await fetchAndSaveComments(id, web);
    setBusy(false);
    if (outcome.status === 'saved') setSaved(outcome.saved);
    else setNotice(outcome.status === 'none' ? t('siteGrabber.commentsNone') : t('siteGrabber.commentsFailed'));
  }, [id, t, web]);

  const remove = useCallback(() => {
    deleteSavedComments(id);
    setSaved(null);
  }, [id]);

  if (!web && !saved) return null;
  const comments = saved?.comments ?? [];
  const shown = expanded ? comments : comments.slice(0, PREVIEW_COUNT);
  return (
    <Box mt={8} gap={8} testID="download-details-comments">
      {saved ? (
        <>
          <Text variant="label" color="textSecondary" style={{ letterSpacing: 0.5 }}>
            {t('siteGrabber.commentsTitle', { count: comments.length })}
          </Text>
          <Text variant="caption" color="textSecondary">
            {t('siteGrabber.commentsSavedAt', { date: formatDownloadDate(saved.savedAt) ?? '' })}
          </Text>
          {shown.map((comment, index) => (
            <Box key={index} gap={2} style={{ paddingStart: Math.min(comment.depth, 4) * 12 }}>
              <Text variant="caption" color="textSecondary">
                {[comment.author, comment.date ? formatDownloadDate(comment.date) : null, comment.likes !== null ? `▲ ${comment.likes}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <Text variant="bodySmall" selectable>
                {comment.text}
              </Text>
            </Box>
          ))}
          {comments.length > PREVIEW_COUNT ? (
            <Button
              title={expanded ? t('siteGrabber.commentsLess') : t('siteGrabber.commentsMore', { count: comments.length })}
              variant="ghost"
              size="small"
              onPress={() => setExpanded((v) => !v)}
              testID="download-details-comments-more"
            />
          ) : null}
          <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }}>
            {web ? (
              <Button title={t('siteGrabber.commentsRefresh')} variant="outline" size="small" leftIcon="refresh" loading={busy} onPress={() => void fetchComments()} testID="download-details-comments-refresh" />
            ) : null}
            <Button title={t('siteGrabber.commentsDelete')} variant="ghost" size="small" leftIcon="delete-outline" onPress={remove} testID="download-details-comments-delete" />
          </Box>
        </>
      ) : (
        <Button
          title={busy ? t('siteGrabber.commentsSaving') : t('siteGrabber.commentsSave')}
          variant="outline"
          size="small"
          leftIcon="comment-text-multiple-outline"
          loading={busy}
          onPress={() => void fetchComments()}
          accessibilityHint={t('siteGrabber.commentsHint')}
          testID="download-details-comments-save"
        />
      )}
      {notice ? (
        <Text variant="caption" color="textSecondary">
          {notice}
        </Text>
      ) : null}
    </Box>
  );
});
