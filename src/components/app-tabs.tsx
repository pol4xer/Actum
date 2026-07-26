import { Tabs } from 'expo-router';
import { ColorValue, StyleSheet, Text } from 'react-native';

import { Palette } from '@/constants/theme';

const icons = {
  index: '⌂',
  journey: '⌁',
  twin: '◫',
  settings: '◎',
};

function TabIcon({ name, color }: { name: keyof typeof icons; color: ColorValue }) {
  return <Text style={[styles.icon, { color }]}>{icons[name]}</Text>;
}

export default function AppTabs() {
  return (
    <Tabs
      screenOptions={{
        animation: 'fade',
        freezeOnBlur: true,
        headerShown: false,
        sceneStyle: { backgroundColor: Palette.ink },
        tabBarActiveTintColor: Palette.goldBright,
        tabBarInactiveTintColor: Palette.textDim,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.tabBar,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Сегодня',
          tabBarIcon: ({ color }) => <TabIcon name="index" color={color} />,
        }}
      />
      <Tabs.Screen
        name="journey"
        options={{
          title: 'Путь',
          tabBarIcon: ({ color }) => <TabIcon name="journey" color={color} />,
        }}
      />
      <Tabs.Screen
        name="twin"
        options={{
          title: 'Двойник',
          tabBarIcon: ({ color }) => <TabIcon name="twin" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Профиль',
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
    backgroundColor: Palette.inkRaised,
    borderTopColor: Palette.line,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
  },
  icon: {
    fontSize: 20,
    lineHeight: 22,
  },
});
