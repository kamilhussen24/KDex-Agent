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

## Where things are
See "Repository layout" in the [README](README.md#how-it-works). Good starting points: `www/js/agent.js` (the tool loop), `www/js/tools.js` (file tools), `www/js/providers.js` (add a provider), `www/js/main.js` (UI).

## Code of conduct
Be respectful and constructive. Harassment or personal attacks are not accepted and may lead to a ban from the project.
