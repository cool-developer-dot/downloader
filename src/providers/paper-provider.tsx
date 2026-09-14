import { PaperProvider, Portal } from 'react-native-paper';
import { type PropsWithChildren, useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { createPaperTheme } from '@/providers/paper-theme';

export function AppPaperProvider({ children }: PropsWithChildren) {
  const theme = useTheme();
  const paperTheme = useMemo(() => createPaperTheme(theme.mode), [theme.mode]);

  return (
    <PaperProvider theme={paperTheme}>
      <Portal.Host>{children}</Portal.Host>
    </PaperProvider>
  );
}
