import type { Href } from 'expo-router';

import type { RoutePath } from '../constants/route-paths';

export type AppHref = Href;

export type TypedRoutePath = RoutePath | AppHref;
