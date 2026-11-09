import { memo } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import {
  acceptTranslateOffer,
  dismissTranslateOffer,
  languageName,
  neverForLanguage,
  neverForSite,
  useTranslateOffer,
} from '../translate-offer.service';

/** B23 #263 — "Translate this page?" over the bottom of the page of the tab in front. */
export const TranslateOfferBanner = memo(function TranslateOfferBanner() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const offer = useTranslateOffer();
  if (!offer) return null;
  const language = languageName(offer.language, t('browserAnnotate.langNames'), t('browserAnnotate.langUnknown'));
  return (
    <View
      testID="translate-offer"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: 8,
        padding: 12,
        gap: 8,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        elevation: 6,
      }}>
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
        <Icon name="translate" size={20} color="primary" />
        <View style={{ flex: 1 }}>
          <Text variant="label" style={{ textAlign: rtl.textAlign }}>
            {t('browserAnnotate.translateOffer')}
          </Text>
          <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
            {t('browserAnnotate.translateOfferDetail', { language })}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('browserAnnotate.translateDismissA11y')}
          onPress={dismissTranslateOffer}
          style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={20} color="secondary" />
        </Pressable>
      </View>
      <View style={{ flexDirection: rtl.rowDirection, gap: 8, flexWrap: 'wrap' }}>
        <Button title={t('browserAnnotate.translateAction')} size="small" onPress={acceptTranslateOffer} testID="translate-offer-accept" />
        <Button title={t('browserAnnotate.translateNeverLanguage')} size="small" variant="outline" onPress={neverForLanguage} />
        <Button title={t('browserAnnotate.translateNeverSite')} size="small" variant="outline" onPress={neverForSite} />
      </View>
    </View>
  );
});
