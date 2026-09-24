import * as Linking from 'expo-linking';

import { routePaths } from '../constants/route-paths';

/**
 * Deep link configuration for VidoraX.
 * Expo Router resolves links automatically from the file-based route tree and app.json scheme.
 * This config documents the expected URL mapping and prefixes.
 */
export const linkingPrefixes = [
  Linking.createURL('/'),
  'vidorax://',
  'https://vidorax.app',
] as const;

export const deepLinkRoutes = routePaths;

export const linkingConfig = {
  prefixes: [...linkingPrefixes],
  config: {
    screens: {
      '(auth)': {
        screens: {
          splash: 'splash',
          onboarding: 'onboarding',
        },
      },
      '(app)': {
        screens: {
          '(tabs)': {
            screens: {
              index: '',
              browser: 'browser',
              downloads: 'downloads',
              library: 'library',
              settings: 'settings',
            },
          },
          about: 'about',
          support: 'support',
          history: 'history',
          'watch-history': 'watch-history',
          bookmarks: 'bookmarks',
          favorites: 'favorites',
          'device-videos': 'device-videos',
          'download-settings': 'download-settings',
          'downloads/queue': 'downloads/queue',
          'downloads/[id]': 'downloads/:id',
        },
      },
    },
  },
} as const;
