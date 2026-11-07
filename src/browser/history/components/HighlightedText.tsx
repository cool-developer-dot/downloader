import { memo, useMemo } from 'react';

import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import { splitHighlight } from '../history-highlight';

type TextProps = React.ComponentProps<typeof Text>;

/**
 * B10 #95 — text with the parts that match a search in the semi-bold face and the accent colour (not colour alone,
 * for colour-blind readers). Without a query it is plain text. Wraps like the text it replaces (`numberOfLines`).
 */
export const HighlightedText = memo(function HighlightedText({
  text,
  query,
  ...textProps
}: { text: string; query: string } & Omit<TextProps, 'children'>) {
  const theme = useTheme();
  const parts = useMemo(() => splitHighlight(text, query), [text, query]);

  if (!parts.some((part) => part.match)) {
    return <Text {...textProps}>{text}</Text>;
  }
  return (
    <Text {...textProps}>
      {parts.map((part, index) =>
        part.match ? (
          <Text key={index} style={{ fontFamily: theme.typography.label.fontFamily, color: theme.colors.primary }}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
});
