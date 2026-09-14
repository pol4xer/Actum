import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { ColorValue, StyleSheet } from 'react-native';

import { GlassSurface } from '@/components/ui/primitives';
import { Palette } from '@/constants/theme';

const icons = {
  index: { ios: 'house.fill', android: 'home', web: 'home' },
  journey: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  twin: { ios: 'person.2.fill', android: 'group', web: 'group' },
  settings: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
} satisfies Record<string, SymbolViewProps['name']>;

function TabBarBackground() {
  return (
    <GlassSurface
      fallbackStyle={styles.tabBarFallback}
      style={StyleSheet.absoluteFill}
      tintColor="rgba(255, 255, 255, 0.25)"
    />
  );
}

function TabIcon({ name, color }: { name: keyof typeof icons; color: ColorValue }) {
  return <SymbolView name={icons[name]} size={21} tintColor={color} style={styles.icon} />;
}

export default function AppTabs() {
  return (
    <Tabs
      screenOptions={{
        animation: 'fade',
        headerShown: false,
        sceneStyle: { backgroundColor: Palette.ink },
        tabBarActiveTintColor: Palette.gold,
        tabBarInactiveTintColor: Palette.textDim,
        tabBarBackground: TabBarBackground,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.tabBar,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <TabIcon name="index" color={color} />,
        }}
      />
      <Tabs.Screen
        name="journey"
        options={{
          title: 'Plan',
          tabBarIcon: ({ color }) => <TabIcon name="journey" color={color} />,
        }}
      />
      <Tabs.Screen
        name="twin"
        options={{
          title: 'Twin',
          tabBarIcon: ({ color }) => <TabIcon name="twin" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon name="settings" color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 78,
    paddingTop: 8,
    paddingBottom: 12,
    position: 'absolute',
    backgroundColor: 'transparent',
    borderTopColor: Palette.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
    shadowColor: Palette.black,
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
  },
  tabBarFallback: {
    backgroundColor: 'rgba(249, 249, 251, 0.94)',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
  },
  icon: {
    width: 22,
    height: 22,
  },
});
