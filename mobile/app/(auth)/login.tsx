import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema } from '@shared/schemas';
import { useAuthStore } from '../../store/authStore';
import { z } from 'zod';

type LoginFormValues = z.infer<typeof LoginSchema>;

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

  const onSubmit = async (data: LoginFormValues) => {
    setServerError(null);
    try {
      const response = await fetch('http://localhost:5001/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Login failed. Invalid credentials.');
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
          <Text className="text-3xl font-bold text-slate-900 tracking-tight">CarUp OS</Text>
          <Text className="text-sm text-slate-500 mt-2 text-center">
            Log in to manage your multi-tenant automotive ecosystem and escrow ledgers.
          </Text>
        </View>

        {/* Form Body */}
        <View className="space-y-5">
          {serverError && (
            <View className="bg-red-50 p-3 rounded-lg border border-red-200">
              <Text className="text-red-600 text-xs font-semibold text-center">{serverError}</Text>
            </View>
          )}

          {/* Email Block */}
          <View>
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

          {/* Password Block */}
          <View className="mt-4">
            <Text className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Password</Text>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="bg-slate-50 border border-slate-200 text-slate-900 p-4 rounded-xl text-base h-12"
                  placeholder="Enter password"
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

          {/* Premium Login Button - 48px Target Area */}
          <Pressable
            className={`w-full bg-slate-900 rounded-xl h-14 mt-8 justify-center items-center ${isSubmitting ? 'opacity-70' : ''}`}
            onPress={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            style={({ pressed }) => pressed ? { opacity: 0.85 } : {}}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-white text-base font-semibold">Sign In</Text>
            )}
          </Pressable>
        </View>

        {/* Footer info */}
        <View className="mt-12 items-center">
          <Text className="text-xs text-slate-400">
            Secure bank-escrow platform compliance enabled
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
