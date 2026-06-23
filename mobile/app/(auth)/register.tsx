import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterSchema } from '@shared/schemas';
import { useAuthStore } from '../../store/authStore';
import { apiUrl } from '../../utils/apiBase';
import { z } from 'zod';

type RegisterFormValues = z.infer<typeof RegisterSchema>;

export default function RegisterScreen() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const [serverError, setServerError] = useState<string | null>(null);

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterFormValues>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      password: '',
      role: 'owner',
    },
  });

  const onSubmit = async (data: RegisterFormValues) => {
    setServerError(null);
    try {
      const response = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Public sign-up is always a Car Owner; never transmit a client-chosen role. The server also
        // rejects any non-owner role request.
        body: JSON.stringify({ ...data, role: 'owner' }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Registration failed. Email might already be taken.');
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
      className="flex-1 bg-white"
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="px-6 py-12 justify-center">
        {/* Header Block */}
        <View className="mb-10 items-center">
          <Text className="text-3xl font-bold text-slate-900 tracking-tight">Create Account</Text>
          <Text className="text-sm text-slate-500 mt-2 text-center">
            Sign up to join the multi-tenant automotive registry and fintech platform.
          </Text>
        </View>

        {/* Form Body */}
        <View className="space-y-4">
          {serverError && (
            <View className="bg-red-50 p-3 rounded-lg border border-red-200">
              <Text className="text-red-600 text-xs font-semibold text-center">{serverError}</Text>
            </View>
          )}

          {/* Full Name */}
          <View>
            <Text className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Full Name</Text>
            <Controller
              control={control}
              name="name"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="bg-slate-50 border border-slate-200 text-slate-900 p-4 rounded-xl text-base h-12"
                  placeholder="Enter full legal name"
                  placeholderTextColor="#94a3b8"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                />
              )}
            />
            {errors.name && (
              <Text className="text-red-500 text-xs mt-1 font-medium">{errors.name.message}</Text>
            )}
          </View>

          {/* Email Address */}
          <View className="mt-4">
            <Text className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Email Address</Text>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="bg-slate-50 border border-slate-200 text-slate-900 p-4 rounded-xl text-base h-12"
                  placeholder="Enter email address"
                  placeholderTextColor="#94a3b8"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              )}
            />
            {errors.email && (
              <Text className="text-red-500 text-xs mt-1 font-medium">{errors.email.message}</Text>
            )}
          </View>

          {/* Phone Number */}
          <View className="mt-4">
            <Text className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Phone Number (Optional)</Text>
            <Controller
              control={control}
              name="phone"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="bg-slate-50 border border-slate-200 text-slate-900 p-4 rounded-xl text-base h-12"
                  placeholder="e.g. +263 773 345 678"
                  placeholderTextColor="#94a3b8"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  keyboardType="phone-pad"
                />
              )}
            />
            {errors.phone && (
              <Text className="text-red-500 text-xs mt-1 font-medium">{errors.phone.message}</Text>
            )}
          </View>

          {/* Password */}
          <View className="mt-4">
            <Text className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Password</Text>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="bg-slate-50 border border-slate-200 text-slate-900 p-4 rounded-xl text-base h-12"
                  placeholder="Create password"
                  placeholderTextColor="#94a3b8"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  secureTextEntry
                  autoCapitalize="none"
                />
              )}
            />
            {errors.password && (
              <Text className="text-red-500 text-xs mt-1 font-medium">{errors.password.message}</Text>
            )}
          </View>

          {/* Public sign-up always creates a Car Owner. Dealers, garages, and partners are onboarded
              through governed, authenticated flows — no privileged role is selectable or transmitted. */}
          <View className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Text className="text-xs text-slate-600">
              You&apos;re creating a <Text className="font-semibold text-slate-900">Car Owner</Text> account. Dealers, garages, and
              partners are onboarded separately by the CarUp team.
            </Text>
          </View>

          {/* Submit Action - 48px Target */}
          <Pressable
            className={`w-full bg-slate-900 rounded-xl h-14 mt-8 justify-center items-center ${isSubmitting ? 'opacity-70' : ''}`}
            onPress={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            style={({ pressed }) => pressed ? { opacity: 0.85 } : {}}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-white text-base font-semibold">Sign Up</Text>
            )}
          </Pressable>

          <Pressable 
            onPress={() => router.replace('/(auth)/login')}
            className="w-full h-12 justify-center items-center mt-2"
          >
            <Text className="text-sm text-slate-500">Already have an account? <Text className="text-orange-500 font-semibold">Log In</Text></Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
