import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema } from '@shared/schemas';
import { useAuthStore } from '../../store/authStore';
import { fetchCsrfToken, getVerificationApiBaseUrl } from '../../utils/verificationApi';
import { z } from 'zod';

type LoginFormValues = z.infer<typeof LoginSchema>;

const inputStyle = {
  backgroundColor: '#F8FAFC',
  borderWidth: 1,
  borderColor: '#E2E8F0',
  color: '#0F172A',
  padding: 16,
  borderRadius: 12,
  fontSize: 16,
  height: 52,
};

const fieldLabelStyle = {
  fontSize: 12,
  fontWeight: '600' as const,
  color: '#334155',
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  marginBottom: 8,
};

const errorTextStyle = {
  color: '#EF4444',
  fontSize: 12,
  marginTop: 4,
  fontWeight: '500' as const,
};

export default function LoginScreen() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const [serverError, setServerError] = useState<string | null>(null);

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const postLogin = async (baseUrl: string, data: LoginFormValues) => {
    // Mutating routes require a signed CSRF token; pre-login it is bound
    // to the guest context (no session token yet).
    const csrfToken = await fetchCsrfToken(baseUrl, null);
    return fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify(data),
    });
  };

  const onSubmit = async (data: LoginFormValues) => {
    setServerError(null);
    try {
      const baseUrl = getVerificationApiBaseUrl();
      let response = await postLogin(baseUrl, data);
      if (response.status === 403) {
        // Stale/mismatched CSRF token — fetch a fresh one and retry once.
        response = await postLogin(baseUrl, data);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error(errorData.error || 'Invalid email or password.');
        }
        if (response.status === 403) {
          throw new Error('Secure session handshake failed (CSRF). Please try again.');
        }
        throw new Error(errorData.error || `Login failed (HTTP ${response.status}). Please try again.`);
      }

      const result = await response.json();
      await login(result.user, result.token);

      // Redirect to main tabs dashboard
      router.replace('/(tabs)');
    } catch (error: any) {
      setServerError(error.message || 'Network error occurred. Please try again.');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: '#FFFFFF' }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingVertical: 48, justifyContent: 'center' }}
      >
        {/* Header Block */}
        <View style={{ marginBottom: 40, alignItems: 'center' }}>
          <Text style={{ fontSize: 30, fontWeight: '700', color: '#0F172A', letterSpacing: -0.5 }}>CarUp OS</Text>
          <Text style={{ fontSize: 14, color: '#64748B', marginTop: 8, textAlign: 'center' }}>
            Log in to manage your multi-tenant automotive ecosystem and escrow ledgers.
          </Text>
        </View>

        {/* Form Body */}
        <View>
          {serverError && (
            <View style={{ backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#FECACA', marginBottom: 20 }}>
              <Text style={{ color: '#DC2626', fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{serverError}</Text>
            </View>
          )}

          {/* Email Block */}
          <View>
            <Text style={fieldLabelStyle}>Email Address</Text>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={inputStyle}
                  placeholder="Enter email address"
                  placeholderTextColor="#94a3b8"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  testID="login-email"
                />
              )}
            />
            {errors.email && (
              <Text style={errorTextStyle}>{errors.email.message}</Text>
            )}
          </View>

          {/* Password Block */}
          <View style={{ marginTop: 16 }}>
            <Text style={fieldLabelStyle}>Password</Text>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={inputStyle}
                  placeholder="Enter password"
                  placeholderTextColor="#94a3b8"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  secureTextEntry
                  autoCapitalize="none"
                  testID="login-password"
                />
              )}
            />
            {errors.password && (
              <Text style={errorTextStyle}>{errors.password.message}</Text>
            )}
          </View>

          {/* Premium Login Button - 48px Target Area */}
          <Pressable
            onPress={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            testID="login-submit"
            style={({ pressed }) => ({
              width: '100%',
              backgroundColor: '#0F172A',
              borderRadius: 12,
              height: 56,
              marginTop: 32,
              justifyContent: 'center',
              alignItems: 'center',
              opacity: isSubmitting ? 0.7 : pressed ? 0.85 : 1,
            })}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Sign In</Text>
            )}
          </Pressable>
        </View>

        {/* Footer info */}
        <View style={{ marginTop: 48, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: '#94A3B8' }}>
            Secure bank-escrow platform compliance enabled
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
