import { useCallback } from 'react';
import { Alert } from 'react-native';
import { authenticateBiometrics, checkBiometricSupport } from '../utils/biometric';
import { useSecureSession } from '../providers/SecureSessionProvider';

export function useBiometricGate() {
  const { isBiometricAvailable } = useSecureSession();

  /**
   * Wraps an action and protects it with a biometric gate.
   * If biometrics are available, requires authentication before executing the action.
   * Otherwise, falls back to alerting or bypasses with confirmation.
   */
  const gateAction = useCallback(
    <T extends (...args: any[]) => any>(
      action: T,
      options?: {
        reason?: string;
        fallbackConfirmTitle?: string;
        fallbackConfirmMessage?: string;
      }
    ) => {
      return async (...args: Parameters<T>): Promise<ReturnType<T> | null> => {
        const support = await checkBiometricSupport();

        if (support.hasHardware && support.isEnrolled) {
          const authenticated = await authenticateBiometrics(
            options?.reason || 'Authenticate to authorize this sensitive action'
          );

          if (authenticated) {
            return action(...args);
          } else {
            console.warn('Biometric gate failed authorization.');
            return null;
          }
        }

        // Fallback for devices without biometric capabilities or enrollment
        return new Promise((resolve) => {
          Alert.alert(
            options?.fallbackConfirmTitle || 'Confirm Security Action',
            options?.fallbackConfirmMessage || 'Would you like to proceed with this sensitive action?',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
              {
                text: 'Proceed',
                onPress: () => {
                  resolve(action(...args));
                },
              },
            ]
          );
        });
      };
    },
    [isBiometricAvailable]
  );

  return {
    gateAction,
    isBiometricAvailable,
  };
}
