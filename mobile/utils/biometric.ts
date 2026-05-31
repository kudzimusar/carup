import * as LocalAuthentication from 'expo-local-authentication';

export async function checkBiometricsSupport(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && isEnrolled;
  } catch (error) {
    console.error('Error checking biometric support:', error);
    return false;
  }
}

export async function checkBiometricSupport(): Promise<{ hasHardware: boolean; isEnrolled: boolean }> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return { hasHardware, isEnrolled };
  } catch (error) {
    console.error('Error checking biometric support details:', error);
    return { hasHardware: false, isEnrolled: false };
  }
}

export async function authenticateWithBiometrics(reason = 'Verify your identity to access CarUp Kimi'): Promise<boolean> {
  try {
    const isSupported = await checkBiometricsSupport();
    if (!isSupported) {
      return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Use PIN/Passcode',
      disableDeviceFallback: false,
    });

    return result.success;
  } catch (error) {
    console.error('Error during biometric authentication:', error);
    return false;
  }
}

export async function authenticateBiometrics(reason = 'Verify your identity to access CarUp Kimi'): Promise<boolean> {
  return authenticateWithBiometrics(reason);
}
