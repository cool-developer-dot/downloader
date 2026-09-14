import { memo, useMemo } from 'react';

import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

export type HighlightedTextProps = {
  text: string;
  query: string;
  variant?: 'body' | 'bodySmall' | 'caption';
  color?: 'textPrimary' | 'textSecondary';
  numberOfLines?: number;
  testID?: string;
};

/**
 * Highlights case-insensitive query matches inside suggestion titles/URLs.
 */
export const HighlightedText = memo(function HighlightedText({
  text,
  query,
  variant = 'bodySmall',
  color = 'textPrimary',
  numberOfLines = 1,
  testID,
}: HighlightedTextProps) {
  const theme = useTheme();
  const parts = useMemo(() => splitHighlight(text, query), [query, text]);

  return (
    <Text variant={variant} color={color} numberOfLines={numberOfLines} testID={testID}>
      {parts.map((part, index) =>
        part.highlight ? (
          <Text
            key={`h-${index}-${part.value}`}
            variant={variant}
            style={{
              color: theme.colors.primary,
              fontFamily: theme.typography.label.fontFamily,
            }}>
            {part.value}
          </Text>
        ) : (
          <Text key={`t-${index}-${part.value}`} variant={variant} color={color}>
            {part.value}
          </Text>
        ),
      )}
    </Text>
  );
});

function splitHighlight(
  text: string,
  query: string,
): { value: string; highlight: boolean }[] {
  const needle = query.trim();
  if (!needle || !text) {
    return [{ value: text, highlight: false }];
  }

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: { value: string; highlight: boolean }[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerNeedle, cursor);
    if (index === -1) {
      parts.push({ value: text.slice(cursor), highlight: false });
      break;
    }

    if (index > cursor) {
      parts.push({ value: text.slice(cursor, index), highlight: false });
    }

    parts.push({
      value: text.slice(index, index + needle.length),
      highlight: true,
    });
    cursor = index + needle.length;
  }

  return parts.length > 0 ? parts : [{ value: text, highlight: false }];
}
