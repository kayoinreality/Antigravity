import { HapticTab } from '@/components/haptic-tab'
import { Tabs } from 'expo-router'
import { Platform } from 'react-native'

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#A29BFE',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.35)',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: '#13131f',
          borderTopColor: 'rgba(255,255,255,0.07)',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
          paddingTop: 10,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.2,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Canvas',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon emoji="✦" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Notes',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon emoji="≡" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  )
}

function TabIcon({
  emoji,
  color,
  focused,
}: {
  emoji: string
  color: string
  focused: boolean
}) {
  const { Text } = require('react-native')
  return (
    <Text
      style={{
        fontSize: focused ? 22 : 18,
        color,
        opacity: focused ? 1 : 0.7,
      }}
    >
      {emoji}
    </Text>
  )
}
