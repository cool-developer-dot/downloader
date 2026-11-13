import { memo, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { TextField } from '@/components/inputs/TextField';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { useBrowserStore } from '@/browser/stores';
import { closedTabsService } from '@/browser/tabs/closed-tabs.service';
import {
  GROUP_COLOR_IDS,
  GROUP_COLORS,
  layoutRows,
  timelineSections,
  type GroupColor,
  type TabGroup,
  type TimelineEntry,
} from '@/browser/tabs/tab-groups';
import {
  closeGroup,
  editGroup,
  moveTabToGroup,
  newGroupWith,
  restoreClosedGroup,
  toggleGroupCollapsed,
  ungroupTabs,
  useClosedGroups,
  useTabGroups,
} from '@/browser/tabs/tab-groups.service';
import type { BrowserTab } from '@/browser/tabs/types';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslateFn } from '@/localization';

import { TabCard } from './TabCard';

export function colorName(t: TranslateFn, color: GroupColor): string {
  for (const pair of t('browserTabGroups.colors').split('|')) {
    const [id, name] = pair.split(':');
    if (id === color && name) return name;
  }
  return color;
}

export function groupTitle(t: TranslateFn, group: TabGroup): string {
  return group.name || t('browserTabGroups.untitled');
}

/** True when some of these tabs are grouped (the list then shows group blocks instead of B1's sortable list). */
export function useHasGroups(tabs: readonly BrowserTab[]): boolean {
  const state = useTabGroups();
  return useMemo(() => tabs.some((t) => state.membership[t.id] != null), [state, tabs]);
}

/** #6 — the tab list as group blocks (B1's order or sort inside each block; pins, sound, sleep stay on the cards). */
export const GroupedTabList = memo(function GroupedTabList({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onOptions,
}: {
  tabs: readonly BrowserTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOptions: (tabId: string) => void;
}) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const state = useTabGroups();
  const [menuGroup, setMenuGroup] = useState<TabGroup | null>(null);
  const [editing, setEditing] = useState<TabGroup | null>(null);
  const byId = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const rows = useMemo(() => layoutRows(state, tabs.map((tab) => tab.id)), [state, tabs]);
  const noop = () => undefined;
  return (
    <View style={{ gap: 8, paddingHorizontal: 12 }} testID="tab-groups-list">
      {rows.map((row) => {
        if (row.kind === 'group') {
          const g = row.group;
          return (
            <View
              key={`g-${g.id}`}
              style={{ flexDirection: rtl.rowDirection, alignItems: 'center', minHeight: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.card, borderStartWidth: 6, borderStartColor: GROUP_COLORS[g.color] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('browserTabGroups.groupA11y', {
                  name: groupTitle(t, g),
                  count: row.tabIds.length,
                  state: t(g.collapsed ? 'browserTabGroups.collapsed' : 'browserTabGroups.expanded'),
                })}
                accessibilityState={{ expanded: !g.collapsed }}
                onPress={() => toggleGroupCollapsed(g.id)}
                testID={`tab-group-${g.id}`}
                style={{ flex: 1, minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
                <Icon name={g.collapsed ? (rtl.isRtl ? 'chevron-left' : 'chevron-right') : 'chevron-down'} size={20} color="secondary" />
                <Text variant="label" numberOfLines={1} style={{ flex: 1, textAlign: rtl.textAlign }}>
                  {groupTitle(t, g)}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {String(row.tabIds.length)}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('browserTabGroups.groupOptions')}
                onPress={() => setMenuGroup(g)}
                style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="dots-vertical" size={20} color="secondary" />
              </Pressable>
            </View>
          );
        }
        const tab = byId.get(row.tabId);
        if (!tab) return null;
        const group = row.groupId ? state.groups.find((g) => g.id === row.groupId) : null;
        return (
          <View key={tab.id} style={group ? { borderStartWidth: 3, borderStartColor: GROUP_COLORS[group.color], paddingStart: 8, marginStart: 8 } : undefined}>
            <TabCard
              tab={tab}
              active={tab.id === activeTabId}
              position={tabs.indexOf(tab) + 1}
              count={tabs.length}
              dragEnabled={false}
              canMoveUp={false}
              canMoveDown={false}
              onSelect={onSelect}
              onClose={onClose}
              onOptions={onOptions}
              onMoveBy={noop}
              // No B1 drag gesture around the cards here: the long-press to the tab's options is the card's own.
              longPressOptions
            />
          </View>
        );
      })}
      <ActionSheetModal
        visible={menuGroup != null}
        title={menuGroup ? groupTitle(t, menuGroup) : ''}
        onClose={() => setMenuGroup(null)}
        actions={
          menuGroup
            ? [
                { id: 'edit', label: t('browserTabGroups.edit'), icon: 'palette-outline', onPress: () => setEditing(menuGroup) },
                { id: 'ungroup', label: t('browserTabGroups.ungroup'), icon: 'ungroup', onPress: () => ungroupTabs(menuGroup.id) },
                { id: 'close', label: t('browserTabGroups.closeGroup'), icon: 'close-box-multiple-outline', destructive: true, onPress: () => closeGroup(menuGroup.id) },
              ]
            : []
        }
      />
      <GroupEditSheet group={editing} onClose={() => setEditing(null)} />
    </View>
  );
});

export const GroupEditSheet = memo(function GroupEditSheet({ group, onClose }: { group: TabGroup | null; onClose: () => void }) {
  const { t } = useTranslation();
  return group ? <GroupEditBody key={group.id} group={group} onClose={onClose} t={t} /> : null;
});

function GroupEditBody({ group, onClose, t }: { group: TabGroup; onClose: () => void; t: TranslateFn }) {
  const theme = useTheme();
  const { rtl } = useTranslation();
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState<GroupColor>(group.color);
  return (
    <SheetFrame
      visible
      title={t('browserTabGroups.edit')}
      onClose={onClose}
      testID="tab-group-edit"
      footer={
        <Button
          title={t('browserTabGroups.save')}
          onPress={() => {
            editGroup(group.id, { name, color });
            onClose();
          }}
          testID="tab-group-save"
        />
      }>
      <View style={{ gap: 12 }}>
        <TextField label={t('browserTabGroups.name')} value={name} onChangeText={setName} maxLength={40} testID="tab-group-name" />
        <View style={{ flexDirection: rtl.rowDirection, flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
          {GROUP_COLOR_IDS.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityLabel={t('browserTabGroups.colorA11y', { color: colorName(t, c) })}
              accessibilityState={{ checked: color === c, selected: color === c }}
              onPress={() => setColor(c)}
              style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: GROUP_COLORS[c], borderWidth: color === c ? 3 : 0, borderColor: theme.colors.textPrimary }}
            />
          ))}
        </View>
      </View>
    </SheetFrame>
  );
}

/** "Add to group": a new group, or one of the groups of the same kind (incognito with incognito). */
export const AddToGroupSheet = memo(function AddToGroupSheet({ tabId, onClose }: { tabId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const state = useTabGroups();
  const incognito = tabId ? isIncognitoTabId(tabId) : false;
  const groups = state.groups.filter((g) => g.incognito === incognito && (tabId ? state.membership[tabId] !== g.id : true));
  return (
    <ActionSheetModal
      visible={tabId != null}
      title={t('browserTabGroups.chooseGroup')}
      onClose={onClose}
      actions={
        tabId
          ? [
              { id: 'new', label: t('browserTabGroups.newGroup'), icon: 'plus', onPress: () => void newGroupWith(tabId) },
              ...groups.map((g) => ({ id: g.id, label: groupTitle(t, g), icon: 'tab' as const, onPress: () => moveTabToGroup(tabId, g.id) })),
            ]
          : []
      }
    />
  );
});

/** #259 — open and recently closed tabs by Today / Yesterday / Earlier (never incognito tabs). */
export const TimelineSheet = memo(function TimelineSheet({ visible, onClose, onSelect }: { visible: boolean; onClose: () => void; onSelect: (tabId: string) => void }) {
  const { t, rtl } = useTranslation();
  const tabs = useBrowserStore((s) => s.tabs);
  const closed = closedTabsService.getSnapshot();
  // Mounted only while open (BrowserTabSwitcher), so "now" is when it opened.
  const [now] = useState(() => Date.now());
  const timeline = useMemo(
    () =>
      timelineSections(
        tabs.map((tab) => ({ id: tab.id, url: tab.url, title: tab.title, lastActiveAt: tab.lastActiveAt, incognito: isIncognitoTabId(tab.id) })),
        closed.map((c) => ({ id: c.id, url: c.url, title: c.title, closedAt: c.closedAt })),
        now,
      ),
    [closed, now, tabs],
  );
  const open = (entry: TimelineEntry) => {
    onClose();
    if (entry.kind === 'open') onSelect(entry.id);
    else {
      const outcome = useBrowserStore.getState().openTabInBackground(entry.url, { title: entry.title });
      if (outcome.status === 'CREATED') onSelect(outcome.tabId);
    }
  };
  const section = (label: string, entries: TimelineEntry[]) =>
    entries.length ? (
      <View key={label} style={{ gap: 4 }}>
        <Text variant="label" accessibilityRole="header" style={{ textAlign: rtl.textAlign }}>
          {label}
        </Text>
        {entries.map((e) => (
          <Pressable key={`${e.kind}-${e.id}`} accessibilityRole="button" onPress={() => open(e)} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text variant="body" numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
              {e.title || e.url}
            </Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
              {`${t(e.kind === 'open' ? 'browserTabGroups.open' : 'browserTabGroups.closed')} · ${new Date(e.at).toLocaleTimeString().slice(0, 5)}`}
            </Text>
          </Pressable>
        ))}
      </View>
    ) : null;
  const empty = !timeline.today.length && !timeline.yesterday.length && !timeline.earlier.length;
  return (
    <SheetFrame visible={visible} title={t('browserTabGroups.timelineTitle')} onClose={onClose} testID="tab-timeline">
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        {empty ? <Text variant="bodySmall" color="textSecondary">{t('browserTabGroups.timelineEmpty')}</Text> : null}
        {section(t('browserTabGroups.today'), timeline.today)}
        {section(t('browserTabGroups.yesterday'), timeline.yesterday)}
        {section(t('browserTabGroups.earlier'), timeline.earlier)}
      </ScrollView>
    </SheetFrame>
  );
});

/** #288 — the last 10 closed groups; Restore opens what fits at the tab limit. */
export const ClosedGroupsSheet = memo(function ClosedGroupsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const groups = useClosedGroups();
  return (
    <SheetFrame visible={visible} title={t('browserTabGroups.closedGroups')} onClose={onClose} testID="closed-groups">
      <View style={{ gap: 8 }}>
        {groups.length === 0 ? <Text variant="bodySmall" color="textSecondary">{t('browserTabGroups.closedGroupsEmpty')}</Text> : null}
        {groups.map((g) => (
          <View key={g.id} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8, minHeight: 48, borderStartWidth: 6, borderStartColor: GROUP_COLORS[g.color], paddingStart: 8, borderRadius: theme.radius.sm }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
                {g.name || t('browserTabGroups.untitled')}
              </Text>
              <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
                {t('browserTabGroups.closedGroupTabs', { count: g.tabs.length })}
              </Text>
            </View>
            <Button
              title={t('browserTabGroups.restore')}
              size="small"
              variant="outline"
              onPress={() => {
                restoreClosedGroup(g.id);
                onClose();
              }}
            />
          </View>
        ))}
      </View>
    </SheetFrame>
  );
});
