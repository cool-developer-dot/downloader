import { useEffect } from 'react';

import { AppLockSetupScreen } from '@/screens/security/AppLockSetupScreen';
import { useAppLockStore } from '@/security/app-lock';

export default function AppLockSetupRoute() {
  useEffect(() => {
    useAppLockStore.getState().beginSetup();
    return () => {
      // If user leaves without commit, drop in-memory setup (no half-enabled lock).
      const { isEnabled, pendingRecoveryCode } = useAppLockStore.getState();
      if (!isEnabled && pendingRecoveryCode) {
        useAppLockStore.getState().cancelSetup();
      }
    };
  }, []);

  return <AppLockSetupScreen />;
}
