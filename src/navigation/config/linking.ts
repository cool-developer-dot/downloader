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
              browser: {
                screens: {
                  index: 'browser',
                  tabs: 'browser/tabs',
                  bookmarks: 'browser/bookmarks',
                  history: 'browser/history',
                  settings: 'browser/settings',
                },
              },
              downloads: {
                screens: {
                  index: 'downloads',
                  add: 'downloads/add',
                  queue: 'downloads/queue',
                  settings: 'downloads/settings',
                  favorites: 'downloads/favorites',
                  '[id]': 'downloads/:id',
                },
              },
              library: 'library',
              files: 'files',
              settings: 'settings',
            },
          },
          about: 'about',
          support: 'support',
          'watch-history': 'watch-history',
          'device-videos': 'device-videos',
        },
      },
    },
  },
} as const;
