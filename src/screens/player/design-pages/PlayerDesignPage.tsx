import { memo, type ReactNode } from 'react';
import { Modal } from 'react-native';

import { DsHeader, DsScreen } from '@/design';
import { useTranslation } from '@/localization';
import { useTourBlocker } from '@/tour/tour-store';

export type PlayerDesignPageProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** ← and Back: back to the video, which played on meanwhile. */
  onBack: () => void;
  /** The header's ⚙: Player settings. */
  onSettings?: () => void;
  children: ReactNode;
  testID?: string;
};

/**
 * A page of the Player as the 65-screen design draws it (screens 20 Gestures, 21 Subtitles, 22 Audio, 24 Video tools,
 * 51 Timers): ← title / subtitle ⚙ over the design's cards, full screen over the video. The video keeps playing under
 * it, and a sheet a row opens comes up above it; Back closes the page.
 */
export const PlayerDesignPage = memo(function PlayerDesignPage({
  visible,
  title,
  subtitle,
  onBack,
  onSettings,
  children,
  testID,
}: PlayerDesignPageProps) {
  const { t } = useTranslation();
  useTourBlocker(visible);
  if (!visible) {
    return null;
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onBack} statusBarTranslucent>
      <DsScreen testID={testID} edges={['top', 'bottom']}>
        <DsHeader
          title={title}
          subtitle={subtitle}
          onBack={onBack}
          action={
            onSettings
              ? {
                  icon: 'settings',
                  accessibilityLabel: t('playerDesign.playerSettings'),
                  onPress: onSettings,
                  testID: testID ? `${testID}-settings` : undefined,
                }
              : undefined
          }
          testID={testID ? `${testID}-header` : undefined}
        />
        {children}
      </DsScreen>
    </Modal>
  );
});
