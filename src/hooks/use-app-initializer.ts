import { useEffect, useState } from 'react';

import { runAppInitializer } from '@/bootstrap';
import { routePaths, type RoutePath } from '@/navigation/constants/route-paths';

type AppInitializerState = {
  isReady: boolean;
  initialRoute: RoutePath | null;
};

export function useAppInitializer(): AppInitializerState {
  const [state, setState] = useState<AppInitializerState>({
    isReady: false,
    initialRoute: null,
  });

  useEffect(() => {
    let isMounted = true;

    runAppInitializer()
      .then((initialRoute) => {
        if (isMounted) {
          setState({ isReady: true, initialRoute });
        }
      })
      .catch(() => {
        if (isMounted) {
          setState({ isReady: true, initialRoute: routePaths.splash });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return state;
}
