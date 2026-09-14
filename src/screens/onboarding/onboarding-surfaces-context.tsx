import { createContext, useContext, useMemo, type PropsWithChildren, type ReactElement } from 'react';

import { useTheme } from '@/hooks/use-theme';
import {
  resolveOnboardingSurfaces,
  type OnboardingSurfaces,
} from '@/theme/onboarding-surfaces';

const OnboardingSurfacesContext = createContext<OnboardingSurfaces | null>(null);

export function OnboardingSurfacesProvider({
  children,
}: PropsWithChildren): ReactElement {
  const theme = useTheme();
  const surfaces = useMemo(
    () => resolveOnboardingSurfaces(theme.mode),
    [theme.mode],
  );

  return (
    <OnboardingSurfacesContext.Provider value={surfaces}>
      {children}
    </OnboardingSurfacesContext.Provider>
  );
}

export function useOnboardingSurfaces(): OnboardingSurfaces {
  const ctx = useContext(OnboardingSurfacesContext);
  const theme = useTheme();
  const fallback = useMemo(
    () => resolveOnboardingSurfaces(theme.mode),
    [theme.mode],
  );
  return ctx ?? fallback;
}
