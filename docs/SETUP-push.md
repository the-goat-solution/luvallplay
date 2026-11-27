# Setting up push notifications (for the owner)

Push notifications go to the store app through Firebase Cloud Messaging. Until every step below is done, nothing is sent and nothing breaks: each missing piece simply leaves push off.

**Never paste a key or a key file into a chat, an email or a pull request.** Each one goes straight into the settings page named below.

## 1. The key that seals phone addresses: `PUSH_KEKS`

A phone's push address is encrypted before it is stored. This is the key for that. You make it yourself:

1. On your own computer, open a terminal and run:

   ```
   node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64'))"
   ```

   It prints one line that starts with `k1:`.
2. Vercel → the **website project** (the one that serves the API) → **Settings → Environment Variables** → add:
   - Name: `PUSH_KEKS`
   - Value: the whole line, including `k1:`
   - Environment: **Production** only
3. Keep a copy in your password manager. If this key is lost, phones simply register again the next time the app opens; nothing else is affected.

To change the key later, put the new one first and keep the old one after a comma (`k2:…,k1:…`): old addresses still open, new ones use the new key.

## 2. The key that lets the server send: `FCM_SERVICE_ACCOUNT`

1. Firebase console → the **Luvallplay** project → ⚙️ **Project settings → Service accounts → Generate new private key**. A `.json` file downloads.
2. Vercel → the same website project → **Settings → Environment Variables** → add:
   - Name: `FCM_SERVICE_ACCOUNT`
   - Value: the **whole contents** of that `.json` file, pasted as they are
   - Environment: **Production** only
3. Delete the downloaded file from your computer once it is saved in Vercel (or keep it only in your password manager).
4. Redeploy the website project so it picks the settings up.

Without this setting the server has no sender: the push channel reports "unavailable" and other channels (email) carry on as before.

## What is still switched off after this

- Club announcements only go out on the new channels when `MESSAGE_CHANNELS` is `on`, which is a separate decision of yours.
- The store app itself needs its Firebase file at build time: `google-services.json` for Android and `GoogleService-Info.plist` for iPhone, plus an APNs key uploaded in Firebase (see `apps/native/README.md`).
