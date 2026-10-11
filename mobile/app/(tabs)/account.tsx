import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, EmptyState, StatusPill } from '../../components/ui/NativePrimitives';
import { spacing, typeScale, useNativeTheme } from '../../theme/tokens';
import { useAuthStore } from '../../store/authStore';

export default function AccountScreen() {
  const theme = useNativeTheme();
  const router = useRouter();
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  if (!loading && !isAuthenticated) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.canvas, justifyContent: 'center' }}>
        <EmptyState
          icon="person-circle-outline"
          title="Your CarUp account"
          body="Sign in to see your vehicles and account tools."
          actionLabel="Sign in"
          onAction={() => router.push('/(auth)/login' as never)}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background.canvas }}
      contentContainerStyle={{ padding: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[10] }}
    >
      <Text allowFontScaling style={{ ...typeScale.titleLarge, color: theme.text.primary }}>Account</Text>
      {user?.name ? <Text allowFontScaling style={{ ...typeScale.bodyStrong, color: theme.text.primary, marginTop: spacing[2] }}>{user.name}</Text> : null}
      {user?.email ? <Text allowFontScaling style={{ ...typeScale.body, color: theme.text.muted, marginTop: spacing[1] }}>{user.email}</Text> : null}
      {user?.role ? <View style={{ marginTop: spacing[3] }}><StatusPill label={user.role === 'owner' ? 'Personal' : user.role} /></View> : null}

      <View style={{ gap: spacing[3], marginTop: spacing[6] }}>
        {user?.role === 'owner' ? (
          <>
            <Button label="My vehicles" variant="secondary" onPress={() => router.push('/(tabs)/garage' as never)} />
            <Button label="Selling" variant="secondary" onPress={() => router.push('/sell' as never)} />
          </>
        ) : null}
        <Button label="Identity" variant="secondary" onPress={() => router.push('/(auth)/verification/intro' as never)} />
      </View>

      <View style={{ marginTop: spacing[8] }}>
        <Button
          label="Sign out"
          variant="tertiary"
          onPress={() => { void logout().then(() => router.replace('/(tabs)' as never)); }}
        />
      </View>
    </ScrollView>
  );
}
