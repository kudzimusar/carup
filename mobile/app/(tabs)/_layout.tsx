import { Tabs } from 'expo-router';
import { View, Text } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: '#0f172a', // Navy brand background
        },
        headerTitleStyle: {
          color: '#ffffff',
          fontWeight: 'bold',
        },
        tabBarStyle: {
          backgroundColor: '#0f172a',
          borderTopWidth: 0,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: '#f97316', // Orange active token
        tabBarInactiveTintColor: '#94a3b8',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          headerTitle: 'CarUp Dashboard',
        }}
      />
      <Tabs.Screen
        name="garage"
        options={{
          title: 'My Garage',
          headerTitle: 'Garage Portal',
        }}
      />
      <Tabs.Screen
        name="escrow"
        options={{
          title: 'Escrow',
          headerTitle: 'SafePay Escrows',
        }}
      />
      <Tabs.Screen
        name="marketplace"
        options={{
          title: 'Marketplace',
          headerTitle: 'CarUp Vehicles',
        }}
      />
    </Tabs>
  );
}
