import * as SecureStore from 'expo-secure-store';

const KEY_ACCESS_TOKEN = 'carup_access_token';
const KEY_REFRESH_TOKEN = 'carup_refresh_token';
const KEY_BIOMETRIC_PREFERENCE = 'carup_biometric_enabled';
const KEY_SESSION_TIMEOUT = 'carup_session_timeout';

export const SECURITY_POLICIES = {
  BIOMETRIC_TIMEOUT_MS: 300000, // 5 minutes inactivity
  REQUIRE_AUTH_ON_RESUME: true,
  REQUIRE_AUTH_FOR_ESCROW: true,
};

export class SecurityService {
  /**
   * Save a sensitive JWT or API token
   */
  static async saveAccessToken(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(KEY_ACCESS_TOKEN, token);
    } catch (error) {
      console.error('Failed to save access token securely:', error);
      throw error;
    }
  }

  /**
   * Retrieve secure access token
   */
  static async getAccessToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(KEY_ACCESS_TOKEN);
    } catch (error) {
      console.error('Failed to read access token securely:', error);
      return null;
    }
  }

  /**
   * Save refresh token securely
   */
  static async saveRefreshToken(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(KEY_REFRESH_TOKEN, token);
    } catch (error) {
      console.error('Failed to save refresh token securely:', error);
      throw error;
    }
  }

  /**
   * Retrieve secure refresh token
   */
  static async getRefreshToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(KEY_REFRESH_TOKEN);
    } catch (error) {
      console.error('Failed to read refresh token securely:', error);
      return null;
    }
  }

  /**
   * Set user preference for biometric lock gates
   */
  static async setBiometricPreference(enabled: boolean): Promise<void> {
    try {
      await SecureStore.setItemAsync(KEY_BIOMETRIC_PREFERENCE, enabled ? 'true' : 'false');
    } catch (error) {
      console.error('Failed to save biometric settings securely:', error);
    }
  }

  /**
   * Retrieve user biometric lock gate preference
   */
  static async getBiometricPreference(): Promise<boolean> {
    try {
      const pref = await SecureStore.getItemAsync(KEY_BIOMETRIC_PREFERENCE);
      return pref === 'true';
    } catch (error) {
      console.error('Failed to read biometric preference securely:', error);
      return false;
    }
  }

  /**
   * Save the background session timestamp for tracking resume gates
   */
  static async saveSessionBackgroundTime(timestampMs: number): Promise<void> {
    try {
      await SecureStore.setItemAsync(KEY_SESSION_TIMEOUT, timestampMs.toString());
    } catch (error) {
      console.error('Failed to save background session timeout securely:', error);
    }
  }

  /**
   * Retrieve the session background time
   */
  static async getSessionBackgroundTime(): Promise<number | null> {
    try {
      const str = await SecureStore.getItemAsync(KEY_SESSION_TIMEOUT);
      return str ? parseInt(str, 10) : null;
    } catch (error) {
      console.error('Failed to retrieve background session time securely:', error);
      return null;
    }
  }

  /**
   * Deletes all local security structures to log out the user
   */
  static async clearAllSecurityData(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(KEY_ACCESS_TOKEN);
      await SecureStore.deleteItemAsync(KEY_REFRESH_TOKEN);
      await SecureStore.deleteItemAsync(KEY_SESSION_TIMEOUT);
    } catch (error) {
      console.error('Failed to clear secure storage structures:', error);
    }
  }
}
