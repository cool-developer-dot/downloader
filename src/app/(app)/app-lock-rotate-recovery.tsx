import { useEffect } from 'react';

import { AppLockRotateRecoveryScreen } from '@/screens/security/AppLockRotateRecoveryScreen';
import { useAppLockStore } from '@/security/app-lock';

export default function AppLockRotateRecoveryRoute() {
  useEffect(() => {
    return () => {
      const { pendingRecoveryCode, status } = useAppLockStore.getState();
      if (status === 'UNLOCKED' && pendingRecoveryCode) {
        useAppLockStore.getState().cancelRotateRecovery();
      }
    };
  }, []);

  return <AppLockRotateRecoveryScreen />;
}
