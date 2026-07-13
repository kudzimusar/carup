import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
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
  borderColor: '#CBD5E1',
  color: '#0F172A',
  padding: 16,
  borderRadius: 12,
  fontSize: 16,
  height: 52,
};

const labelStyle = {
  fontSize: 13,
  fontWeight: '700' as const,
  color: '#334155',
  marginBottom: 6,
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

  // Radically simple, top-aligned, single-column layout. No vertical centering,
  // no fixed bottom bar, no footer — the submit button is in the same scroll
  // flow directly below the password so it is always visible on iPhone.
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: '#FFFFFF' }}
    >
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 64, paddingBottom: 64 }}
      >
        {/* Title */}
        <Text style={{ fontSize: 26, fontWeight: '800', color: '#0F172A', marginBottom: 24 }}>
          Sign in to CarUp
        </Text>

        {/* Error banner (if any) */}
        {serverError && (
          <View style={{ backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#FECACA', marginBottom: 20 }}>
            <Text style={{ color: '#DC2626', fontSize: 13, fontWeight: '600' }} testID="login-server-error">{serverError}</Text>
          </View>
        )}

        {/* Email label + field */}
        <Text style={labelStyle}>Email</Text>
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={inputStyle}
              placeholder="you@example.com"
              placeholderTextColor="#94a3b8"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              testID="login-email"
            />
          )}
        />
        {errors.email && <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 4 }}>{errors.email.message}</Text>}

        {/* Password label + field */}
        <Text style={[labelStyle, { marginTop: 16 }]}>Password</Text>
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
        {errors.password && <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 4 }}>{errors.password.message}</Text>}

        {/* Visible marker text directly above the button */}
        <Text style={{ color: '#0F172A', fontSize: 13, fontWeight: '800', marginTop: 24, marginBottom: 8 }} testID="login-visible-marker">
          VISIBLE LOGIN BUTTON BELOW
        </Text>

        {/* Visible submit CTA — directly below the password, in the same flow.
            Orange background, white text, minHeight 64, full width, solid border,
            never opacity 0. Rendered unconditionally (only the inner label swaps
            to a spinner while submitting). */}
        <TouchableOpacity
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          activeOpacity={0.85}
          testID="login-submit"
          accessibilityRole="button"
          accessibilityLabel="Sign In"
          style={{
            width: '100%',
            minHeight: 64,
            backgroundColor: '#F97316',
            borderRadius: 12,
            borderWidth: 2,
            borderColor: '#C2410C',
            justifyContent: 'center',
            alignItems: 'center',
            paddingVertical: 12,
          }}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 }}>
              SIGN IN — VISIBLE CTA
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
