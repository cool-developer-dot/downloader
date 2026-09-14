import { memo } from 'react';

import { QuickAccessSection } from '@/browser/components/QuickAccess';
import { useQuickAccessHandoff } from '@/browser/hooks/useQuickAccessHandoff';

import { useHomeLayout } from '../theme/home-layout';

export const HomeQuickAccess = memo(function HomeQuickAccess() {
  const layout = useHomeLayout();
  const openInBrowser = useQuickAccessHandoff();

  return (
    <QuickAccessSection
      showTitle
      showSubtitle
      density="compact"
      paddingTop={layout.quickAccessTop}
      onOpenSite={openInBrowser}
      horizontalPadding={layout.screenX}
      testID="home-quick-access"
    />
  );
});
