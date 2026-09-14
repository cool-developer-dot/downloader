import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Button } from '@/components/buttons/Button';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useHomeLayout } from '../theme/home-layout';

export type HomePrimaryActionsProps = {
  onPasteLink: () => void;
};

export const HomePrimaryActions = memo(function HomePrimaryActions({
  onPasteLink,
}: HomePrimaryActionsProps) {
  const layout = useHomeLayout();
  const { t } = useTranslation();

  const openBrowser = useCallback(() => {
    navigation.navigate(routePaths.browser);
  }, []);

  return (
    <Box
      px={16}
      testID="home-primary-actions"
      style={{ paddingTop: layout.actionsTop }}>
      <Box row={!layout.stackedActions} gap={layout.actionsGap}>
        <Box flex={layout.stackedActions ? undefined : 1}>
          <Button
            title={t('home.pasteLink')}
            leftIcon="link-variant"
            size="small"
            onPress={onPasteLink}
            accessibilityLabel={t('home.pasteLinkA11y')}
            testID="home-paste-link-button"
            fullWidth
          />
        </Box>
        <Box flex={layout.stackedActions ? undefined : 1}>
          <Button
            title={t('home.openBrowser')}
            leftIcon="web"
            variant="outline"
            size="small"
            onPress={openBrowser}
            accessibilityLabel={t('home.openBrowserA11y')}
            testID="home-open-browser-button"
            fullWidth
          />
        </Box>
      </Box>
    </Box>
  );
});
