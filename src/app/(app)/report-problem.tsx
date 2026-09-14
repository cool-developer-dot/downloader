import { useLocalSearchParams } from 'expo-router';

import { parseSupportContextParams } from '@/support';
import { ReportProblemScreen } from '@/screens/support';

export default function ReportProblemRoute() {
  const rawParams = useLocalSearchParams<Record<string, string>>();
  const context = parseSupportContextParams(rawParams);
  return (
    <ReportProblemScreen
      initialCategory={context.reportCategory}
      initialSource={context.source}
    />
  );
}
