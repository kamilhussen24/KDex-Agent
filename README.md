# KDex Agent

**A private AI coding and project assistant for Android.** Open a folder on your phone, tell the AI what to change, review every edit as a diff, then commit and push with built-in Git.

Bring your own API key. No server, no account, no analytics: your keys, chats and files stay on your phone.

[![Latest release](https://img.shields.io/github/v/release/kamilhussen24/KDex-Agent?label=release)](https://github.com/kamilhussen24/KDex-Agent/releases/latest)
![Platform](https://img.shields.io/badge/platform-Android%208%2B-3ddc84)
![License](https://img.shields.io/badge/license-source--available-D6334F)

## Features

**Chat**
- Works with your own key from Anthropic, OpenAI, Gemini, DeepSeek, xAI, Groq, Mistral, OpenRouter or any OpenAI-compatible endpoint.
- Thinking levels (Off, Low, High), memory notes, chat history with search, token saving, and usage with estimated cost.
- Attach text files and images. Built-in ZIP tools (the model cannot run `unzip`, so the app does it).

**Project folders**
- The agent can list, search, read, create, edit and delete files, only inside the folder you choose.
- Every change is shown as a diff. You Apply or Reject it, a backup is saved first, and Undo is one tap. Auto mode is optional.
- File viewer with syntax colours, image preview and a diff viewer with changed words highlighted.
- Optional "All files access" for much faster file and Git work, like Termux.

**Git, built in**
- Clone, status, diff, commit, push, pull, fetch, branches, history and discard. Works with GitHub, GitLab and any https remote using an access token.
- Every push asks for your approval, even in Auto mode. Tokens are stored with the Android Keystore.

**Terminal (optional)**
- Runs commands in the Termux app after you approve each one: install packages, run scripts and tests, use real `git`.

**Safety**
- Secret files (`.env`, keys, credentials) are hidden from the AI and the chat. The agent can still run your project; secret values never reach the model and are masked in output.
- Nothing is deleted without approval, and a likely secret in a commit is flagged before you push.

**Everyday comfort**
- Keeps working with the screen off and notifies you when it is done or needs your approval.
- Share text, links or files from other apps into a chat.
- Backup and restore (API keys are never included), light and dark themes, a private diagnostics log, update check in Settings > About.

## Install
1. Open the [latest release](https://github.com/kamilhussen24/KDex-Agent/releases/latest) on your phone and download `KDex-Agent-release.apk`.
2. Open the file. Android asks you to allow installs from your browser or file manager (this is normal for apps outside Google Play).
3. Later updates install over the old version from Settings > About > Check for updates. Chats and settings stay.

## First steps
1. Pick a provider, paste your API key, choose a model.
2. Tap **Add folder** and choose a project folder (Android does not allow the whole storage; pick a subfolder).
3. Ask for a change, review the diff, tap **Apply**. Use **Changes** to undo.

## How it works

KDex Agent is a hybrid app: the interface is plain HTML, CSS and JavaScript inside a Capacitor WebView, and a small Java plugin does what a web page cannot do.

```
        Android phone
 ┌───────────────────────────────────────────────┐
 │  WebView (www/)                               │
 │   main.js ── UI, chats, sheets                │
 │   agent.js ─ context, streaming, tool loop    │
 │   tools.js, git.js, termux.js ─ what the AI   │
 │   can do, each guarded by approval            │
 │            │ Capacitor bridge (native.js)     │
 │  Java plugin (native/)                        │
 │   Keystore · streaming HTTP · folder access   │
 │   JGit · Termux bridge · background service   │
 └───────────────┬───────────────────────────────┘
                 │ HTTPS, with your own key
          AI provider · Git host · GitHub (updates)
```

Chats, settings and file backups live in IndexedDB on the phone. API keys and Git tokens live in the Android Keystore. There is no KDex server.

### Repository layout
| Path | What it holds |
| --- | --- |
| `www/index.html`, `www/css/app.css` | Screens and styling (light and dark) |
| `www/js/main.js` | UI layer: chat, drawer, sheets, settings, dialogs |
| `www/js/agent.js` | Builds context, streams replies, runs the tool loop, approvals |
| `www/js/providers.js` | Adapters for each AI provider |
| `www/js/tools.js`, `archive.js` | File tools and ZIP tools offered to the model |
| `www/js/git.js`, `gittools.js` | Git engine and the Git tools offered to the model |
| `www/js/termux.js` | Optional terminal through Termux |
| `www/js/secrets.js` | Secret-file protection and masking |
| `www/js/native.js` | Bridge to the Java plugin, with a browser fallback for development |
| `www/js/db.js`, `diag.js`, `update.js`, `util.js` | Storage, diagnostics log, update check, helpers |
| `www/vendor/`, `www/fonts/`, `www/img/` | Bundled libraries, Inter font, logo (no build step) |
| `native/` | Java: `KdexNativePlugin` (main plugin), `KdexGit` (JGit), `KdexWorkService` (background work) |
| `scripts/prepare-android.mjs` | Patches the generated Android project (plugin, manifest, icons, version, signing) |
| `.github/workflows/android.yml` | CI: builds the APK and publishes releases |
| `assets/` | Source icons and splash |

The `android/` folder is generated in CI and is not committed.

## Build and release

### Run the interface in a browser (fastest way to work on the UI)
```
cd www && python3 -m http.server 8080
```
Open `http://localhost:8080`. Without the phone plugin the app uses an in-memory demo folder, so the UI, chat and diffs work. Native features (Keystore, real folders, notifications, Termux, Share) need a phone.

### Build an APK
Push your fork to GitHub and run **Actions > Build Android APK > Run workflow** with `debug` (no secrets needed), then download the APK from the run's Artifacts. Or locally:
```
npm ci && npx cap add android && npx cap sync android && node scripts/prepare-android.mjs
cd android && ./gradlew assembleDebug
```

### Publish a release (maintainer)
1. Add the entry to `CHANGELOG.md` and raise `version` in `package.json` and `www/js/config.js`.
2. Push to `main`. GitHub Actions builds the signed APK, creates the tag `vX.Y.Z` and the GitHub Release (notes come from `CHANGELOG.md`) and attaches `KDex-Agent-release.apk`. If the tag already exists nothing happens.

Signing needs four repository secrets (Settings > Secrets and variables > Actions): `KEYSTORE_BASE64` (the keystore file as base64), `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. Create the keystore once and keep a backup; updates install over an older version only when signed with the same key.
```
keytool -genkeypair -v -keystore kdex.keystore -alias kdex -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 kdex.keystore
```

## Contributing
Ideas, bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up, the conventions and the review checklist. Report security problems privately, see [SECURITY.md](SECURITY.md).

## License
KDex Agent is **source-available**, not open source in the OSI sense. You can read the code, use the app, change it for yourself and send improvements back. You may not redistribute it (modified or not), publish it under your own name, or sell it. See [LICENSE](LICENSE) for the exact terms. Versions 1.38.0 and earlier were released under the MIT License. Third-party components keep their own licenses (Settings > About > Licenses).

## Privacy and limits
- No server, accounts or analytics. See [PRIVACY.md](PRIVACY.md).
- Android 11 and newer do not let apps pick the storage root or the Download folder; choose a subfolder.
- Files over 1 MB are truncated when read; binary files cannot be edited.
- Very large repositories can be slow on a phone.
- Cost estimates exist only for models with known prices; tokens are always counted.

Made by [Kamil Hussen (KDex)](https://kamildex.com).
