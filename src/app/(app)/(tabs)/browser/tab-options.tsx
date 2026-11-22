// Design 35 "Tab · Long-press menu": `/browser/tab-options?tabId=<id>`, from a long-press on a tab's tile.
import { useLocalSearchParams } from 'expo-router';

import { TabOptionsScreen } from '@/browser/components/BrowserTabSwitcher/TabOptionsScreen';

export default function TabOptionsRoute() {
  const { tabId } = useLocalSearchParams<{ tabId?: string }>();
  return <TabOptionsScreen tabId={typeof tabId === 'string' ? tabId : ''} />;
}
