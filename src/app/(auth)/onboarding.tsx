import { OnboardingRouteGuard } from '@/navigation/guards/OnboardingRouteGuard';
import { OnboardingScreen } from '@/screens/onboarding';

export default function OnboardingRoute() {
  return (
    <OnboardingRouteGuard>
      <OnboardingScreen />
    </OnboardingRouteGuard>
  );
}
