import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

type UseAndroidBackHandlerOptions = {
  enabled?: boolean;
  onBackPress: () => boolean;
};

export function useAndroidBackHandler({
  enabled = true,
  onBackPress,
}: UseAndroidBackHandlerOptions): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) {
        return undefined;
      }

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);

      return () => {
        subscription.remove();
      };
    }, [enabled, onBackPress]),
  );
}
