// The phone's own secret store (iOS Keychain, Android Keystore) for the
// session token, through the shell's secure-storage plugin. Reads and writes
// are asynchronous there, which is why the app waits for the token before
// its first screen (store.ready() in main.tsx).
import type { SecretStore } from "../storage.ts";
import { plugin } from "./platform.ts";

/** The plugin's shape (capacitor-secure-storage-plugin): `get` rejects when the key isn't there. */
type SecureStoragePlugin = {
  get(options: { key: string }): Promise<{ value: string }>;
  set(options: { key: string; value: string }): Promise<unknown>;
  remove(options: { key: string }): Promise<unknown>;
};

/** The secret store in the store app; undefined in a browser, or if the shell was built without the plugin. */
export function nativeSecrets(prefix = "lp.", native: SecureStoragePlugin | undefined = plugin<SecureStoragePlugin>("SecureStoragePlugin")): SecretStore | undefined {
  if (!native) return undefined;
  return {
    async get(key) {
      try {
        return (await native.get({ key: prefix + key })).value || null;
      } catch {
        return null;
      }
    },
    set: async (key, value) => void (await native.set({ key: prefix + key, value })),
    async remove(key) {
      try {
        await native.remove({ key: prefix + key });
      } catch {
        // Not there: nothing to remove.
      }
    },
  };
}
