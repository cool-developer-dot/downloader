import { Fragment, type PropsWithChildren } from 'react';

/**
 * Launch routes (splash / onboarding) are not account-gated.
 */
export function GuestRouteGuard({ children }: PropsWithChildren) {
  return <Fragment>{children}</Fragment>;
}
