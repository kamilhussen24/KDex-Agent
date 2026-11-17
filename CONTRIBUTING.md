# Contributing to KDex Agent

Thanks for helping. Please read the [LICENSE](LICENSE) first: contributions are
welcome, but the project is source-available, and by sending a contribution you
agree to section 4 (the Licensor may use and relicense it).

## Ways to help
- Report a bug or suggest a feature with an [issue](https://github.com/kamilhussen24/KDex-Agent/issues/new/choose).
- Improve the UI, the agent, Git, the documentation or the Java plugin with a pull request.
- Test on different phones and Android versions and report what you see.

For anything bigger than a small fix, open an issue first so the direction is agreed before you spend time.

## Workflow
1. Fork the repository on GitHub and create a branch from `main` (`fix-long-title`, `feature-share-images`).
2. Make a small, focused change.
3. Check it (see below).
4. Add a line under `[Unreleased]` in `CHANGELOG.md` (Added, Changed, Fixed or Removed).
5. Open a pull request using the template. Explain what changed and why; screenshots (light and dark) help for UI changes.

Do not change `version` in `package.json`; the maintainer does that when releasing.

## Set up
```
git clone https://github.com/<you>/KDex-Agent.git
cd KDex-Agent/www && python3 -m http.server 8080
```
Open `http://localhost:8080`. The app has a browser fallback (an in-memory demo folder), so the UI, chat and diffs can be developed without a phone. The interface is plain ES modules; there is no bundler and no build step for `www/`.

There is no automated test suite in the repository. Check your change by hand in the browser (light and dark, 320 to 412 px wide) and run a quick syntax check with `node --check www/js/<file>.js` for each JavaScript file you edited.

Libraries in `www/vendor/` are bundled copies (pdf.js, fflate, isomorphic-git, LightningFS, CodeMirror) with their license files. Do not edit them; to update one, replace the file, keep its `LICENSE-*.md` and add it to Settings > About > Licenses.

The code editor (`www/vendor/codemirror.min.js`) is the one vendored file that is built from source. Its entry file, pinned package versions and build script are in `tools/editor/`. To change it: `cd tools/editor && npm install && npm run build`, then commit the new bundle. `node_modules` is not committed.

Native features (Keystore, real folders, Git on real repositories, notifications, Share, Termux) need a phone. Build a debug APK with **Actions > Build Android APK > Run workflow > debug** on your fork and install it. Java cannot be compiled in a browser, so keep native changes small and describe how you tested them.

## Conventions
- **Language:** all UI text, code comments and docs in English.
- **UI:** it must work in light and dark themes and at 320 to 412 px wide with nothing clipped or off-screen. Icons sit centred on their labels. Reuse existing components (sheets, dialogs, buttons) and the colour variables in `app.css`; do not add new styles for one-off cases.
- **Changes:** targeted. Do not rewrite or reformat code you are not changing.
- **Safety rules (do not weaken):**
  - Secret files (`.env`, keys) stay hidden from the AI and the chat; secret values never reach the model.
  - Every file change, terminal command and `git push` needs the user's approval (push even in Auto mode).
  - Never delete a user's files or repository content automatically.
  - Keys and tokens only in the Android Keystore; never log them.
- **Privacy:** no analytics, no new servers, no network calls except to the user's AI provider, their Git host and the public GitHub releases API.
- **Dependencies:** avoid adding any. If you must, say why.
- **Commits:** short imperative subject, for example `Fix long file name hiding the close button`.

## Before you open the pull request
- [ ] The app starts and the screens you touched work in the browser, light and dark.
- [ ] You tried native behaviour on a phone if you touched it.
- [ ] No keys, tokens or personal data in code, logs or screenshots.
- [ ] `CHANGELOG.md` updated.

## Before you add a feature
Anything that needs a new Android permission, a new foreground service type, installing or updating APKs, or sending a new kind of user data off the phone must be said in the pull request and in `PRIVACY.md`. Check the current Android documentation first, because the rules change.

## Where things are
See "Repository layout" below. Good starting points: `www/js/agent.js` (the tool loop), `www/js/tools.js` (file tools), `www/js/providers.js` (add a provider), `www/js/main.js` (UI).

## Architecture

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

## Releasing (maintainers)
1. Add the entry to `CHANGELOG.md` (move the lines from `[Unreleased]` under a new `## [X.Y.Z]` heading) and raise the version in all four places: `package.json` (line 3), `package-lock.json` (lines 3 and 9) and `www/js/config.js` (`APP_VERSION`). Keep them identical.
2. Push to `main`. GitHub Actions builds the signed APK, creates the tag `vX.Y.Z` and the GitHub Release (notes come from `CHANGELOG.md`) and attaches `KDex-Agent-release.apk`. If the tag already exists nothing happens.

Signing needs four repository secrets (Settings > Secrets and variables > Actions): `KEYSTORE_BASE64` (the keystore file as base64), `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. Create the keystore once and keep a backup; updates install over an older version only when signed with the same key.
```
keytool -genkeypair -v -keystore kdex.keystore -alias kdex -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 kdex.keystore
```

## Code of conduct
Be respectful and constructive. Harassment or personal attacks are not accepted and may lead to a ban from the project.
