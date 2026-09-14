import { createContext, useContext, type PropsWithChildren } from 'react';

import { useAppInitializer } from '@/hooks/use-app-initializer';
import type { RoutePath } from '@/navigation/constants/route-paths';

type AppInitializerContextValue = {
  isReady: boolean;
  initialRoute: RoutePath | null;
};

const AppInitializerContext = createContext<AppInitializerContextValue>({
  isReady: false,
  initialRoute: null,
});

export function AppInitializerProvider({ children }: PropsWithChildren) {
  const value = useAppInitializer();

  return <AppInitializerContext.Provider value={value}>{children}</AppInitializerContext.Provider>;
}

export function useAppInitializerState(): AppInitializerContextValue {
  return useContext(AppInitializerContext);
}
