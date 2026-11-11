# KDex Agent for Android

A private AI chat that works inside a folder you choose, like Claude Code on your phone.
Bring your own API key (Anthropic, OpenAI, DeepSeek, OpenRouter or any OpenAI-compatible endpoint).
No server and no account: keys, chats, memory and backups stay on the phone.

## Features
- Git: clone a repository into a folder you pick, let the agent edit it, then review the diff, commit and push (token login). Also pull, branches, history, discard.
- Chat with thinking (Off / Low / High), collapsible thought card, memory notes, chat history
- Pick a project folder with Android's file manager; the model can list, search, read, create, edit and delete files only inside it
- Every change needs your approval (Apply / Reject / Apply all), a backup is saved first, and Undo is one tap
- Token saving (rolling summaries, compacted tool output), per-day usage and estimated cost in USD
- Image and text-file attachments, dark and light theme

## Build the APK with GitHub Actions
1. Create a new GitHub repository and push this project to it (the `android/` folder is generated in CI, so it is not committed).
2. Open **Actions > Build Android APK > Run workflow**.
   - **debug**: works immediately, no secrets needed. Good for testing.
   - **release**: signed APK to share directly. Needs the four secrets below.
   - **release-aab**: signed Android App Bundle for Google Play (see STORE-LISTING.md).
3. When the run finishes, download the APK from the run's **Artifacts** section.
4. Pushing a tag such as `v1.0.0` also builds a release APK and attaches it to a GitHub Release.

### Release signing (one time)
Create a keystore on any computer with Java:

```
keytool -genkeypair -v -keystore kdex.keystore -alias kdex -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 kdex.keystore > kdex.keystore.b64
```

Add these repository secrets (Settings > Secrets and variables > Actions):

| Secret | Value |
| --- | --- |
| `KEYSTORE_BASE64` | contents of `kdex.keystore.b64` |
| `KEYSTORE_PASSWORD` | the keystore password |
| `KEY_ALIAS` | `kdex` (or the alias you chose) |
| `KEY_PASSWORD` | the key password |

Keep the keystore safe. Updates must be signed with the same key or users have to uninstall first.

## Install
Copy the APK to the phone and open it. Android will ask you to allow installs from your browser or file manager ("unknown sources"). This is normal for apps shared outside Google Play.

## Using it
1. First launch: pick a provider, paste your API key, choose models.
2. Open **Projects > Open a folder...** and choose a folder in the file manager.
3. Ask for changes. Review each diff and tap **Apply**. Use **Changes** to undo.

## Git notes
- The working files are in your folder; the .git data is kept inside the app (fast, and keeps your folder clean). A folder that already has a .git directory from another tool is treated as plain files.
- Authentication is by personal access token over https.
- Clone downloads a shallow copy by default (latest commit). Tick full history if you need older commits.
- Very large repositories can be slow or run out of memory on a phone.

## Limitations
- Android 11+ does not let apps pick the storage root or the Download folder. Choose a subfolder.
- The model cannot run code or shell commands, only read and edit files.
- Files over 1 MB are truncated when read; binary files are not editable.
- Cost estimates are shown only for models with known prices; tokens are always counted.

## Project layout
- `www/vendor/` isomorphic-git, LightningFS, Buffer polyfill, Capacitor core (bundled, no build step)
- `www/` web UI (plain ES modules, no bundler)
- `native/KdexNativePlugin.java` Capacitor plugin: encrypted key storage, streaming HTTP, folder access
- `scripts/prepare-android.mjs` patches the generated Android project (plugin, icons, splash, version, signing)
- `.github/workflows/android.yml` CI build

## Local build (optional)
```
npm ci && npx cap add android && npx cap sync android && node scripts/prepare-android.mjs
cd android && ./gradlew assembleDebug
```

## v1.3.0
- Providers: Gemini, xAI, Mistral, Groq, Together added. Setup shows a short suggested model list; the full list loads only on request, with search. Any model id can be typed. Models can be added or removed later in Settings.
- Git: explicit Stage / Unstage (Staged and Changes sections), history shows the last 10 commits with a "Show 10 more" button (max 50).
- Native dialogs replaced by in-app dialogs (API key change, memory notes).
