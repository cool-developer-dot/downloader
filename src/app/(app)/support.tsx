import { useLocalSearchParams } from 'expo-router';

import { parseSupportContextParams } from '@/support';
import { SupportScreen } from '@/screens/legal';

export default function SupportRoute() {
  const rawParams = useLocalSearchParams<Record<string, string>>();
  const context = parseSupportContextParams(rawParams);
  return <SupportScreen initialContext={context} />;
}
