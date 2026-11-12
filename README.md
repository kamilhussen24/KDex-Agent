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

## v1.3.1
- Built-in `unzip` and `zip` tools (vendor/fflate.js, MIT). The model cannot run commands, so it now extracts and creates .zip files itself after your approval. Existing files are never overwritten; unsafe paths are rejected; limits: 60 MB zip, 200 MB extracted, 3000 files.
- Fixed the layout of code blocks (language label and Copy button now form a proper header).

## v1.4.0 — Termux terminal (optional, advanced)
Settings > Terminal (Termux) lets the agent run shell commands (`run_command`) in the Termux app: unzip, npm/pip, scripts, tests, git, curl. Off by default; **every command needs your approval** (Run button), with a warning for destructive commands.
- Build adds the `com.termux.permission.RUN_COMMAND` permission and a `<queries>` entry for `com.termux` (see scripts/prepare-android.mjs). This makes the app unsuitable for Google Play; it is meant for personal and open-source use.
- Setup: install Termux (F-Droid/GitHub), add `allow-external-apps=true` to `~/.termux/termux.properties`, restart Termux, tap Grant permission in Settings.
- The project's Termux path is derived from the picked folder (Termux's own storage provider, or shared storage). It can be changed in Settings.
- Not verified on a device yet: the native call follows Termux's documented RUN_COMMAND intent (mutable PendingIntent returns stdout/stderr/exit code).

## v1.5.0
- Git: repositories now keep a real `.git` folder inside the project, so Termux and other tools see the same repository. A folder that already has a `.git` is detected automatically (remote, branch, changes). Repositories made by older versions keep working. A banner appears when the remote host has no saved token.
- Clone always creates a new folder named after the repository inside the folder you choose (it does not have to be empty) and opens it as a project.
- Setup shows Anthropic, OpenAI, Gemini, DeepSeek, xAI and Custom (with quick fills for OpenRouter, Groq, Mistral, Together, Ollama). "Skip for now" lets you use files and Git without a model; sending a message then asks you to connect one.
- Terminal chip in the chat bar opens the Termux setup and switch. The agent is told how to use it like a computer shell.
- Fixes: Copy button crash and clipboard fallback, spacing of stacked buttons and key/value rows.

## v1.5.1
- Fixed: after a Git action (fetch, pull, push, commit) the sheet's Close and Back buttons stayed disabled. Only the sheet body is locked while an action runs, and the header is always re-enabled.
- The Thinking control is now an icon button like Attach, with a small dot when thinking is on.

## v1.5.2
- Fixed: the theme (System / Light / Dark) was applied one tap late, because it was read before the new choice was saved. Settings now apply at once and are written to storage in order.
- The theme is remembered at launch, so Dark mode no longer flashes white on start.
- The Android status and navigation bars now follow the chosen theme (new `setBars` call in the native plugin).
- Native controls (dropdowns, scrollbars, text fields) follow the chosen theme, not only the phone's.
- Browser tests added in `tests/` (theme, Git sheet, first run). Removed unused code.

## v1.6.0
- Settings now uses a real gear icon.
- The assistant knows the app: who made it, what it can and cannot do, where settings are, and answers in the user's language.
- Thinking: Off, Low, Medium and High, with larger budgets for Medium and High.
- Token saving by default: tighter history budgets (Economy 3,000, Balanced 9,000), repeated reads of an unchanged file are skipped, older tool output is trimmed, Anthropic prompt caching is on.
- Token usage page: tokens only. Today, this month, last 7 days. Prices removed. Days older than 14 are deleted.
- Model lists: up to 8 popular models are shown; search shows up to 10; any other model id can be typed. Non-chat models (embedding, image, audio) are hidden.
- Terminal: the model is told to read stdout, stderr and the exit code, report the real result, and retry a failed command at most twice. Results now say "Command succeeded" or "Command FAILED". An empty final reply after tool work gets a fallback message.

## v1.7.0
- Always allow: a terminal command card has "Always allow <command> in this chat". Later commands that use only allowed commands run without asking. Dangerous commands, `rm`, `sudo`, `curl`/`wget`, `ssh`, shells, `git push`/`reset`/`rebase`, and anything with `$( )` or backticks always ask. The list belongs to the chat.
- Task checklist: the model keeps one live "Plan" card up to date for tasks with three or more steps.
- Background jobs: `start_job`, `check_job`, `stop_job`, `list_jobs` run servers and watchers in Termux with logs in `~/.kdex/jobs`. Starting a job asks for approval. Checking, listing and stopping do not.

## v1.8.0
- Auto mode per chat: a chip above the messages switches between "Ask first" and "Auto". In Auto, file changes, deleting files (backed up, Undo works), zip/unzip, commits, pulls and everyday commands run without asking. Risky actions still ask: `rm`, `sudo`, `dd`, `chmod`/`chown`, `kill`, `ssh`, `git push`/`reset`/`clean`/`rebase`, publishing, and `curl | sh`.
- Turning Auto on approves the actions that are already waiting, except risky ones.
- Settings > Approvals in new chats sets the default for new chats.

## v1.8.1
- The assistant now knows Termux runs on a phone (ARM, limited memory and storage, no root, no sudo/Docker/apt) and keeps installs small: it checks space and memory first, prefers `pkg` packages and light tools, and says so when a task is too heavy for a phone.

## v1.14.0

- Plain settings no longer need the secret box. For ordinary, non-secret variables (PORT, HOST, NODE_ENV, APP_ENV, DEBUG, LOG_LEVEL, TZ, LANG, WORKERS and similar) the agent passes a sensible value and the app writes it itself. In Ask first chats you approve a small card showing the line; in Auto it is written directly. Missing variables only; existing ones are never changed.
- The app, not the model, decides what counts as plain: names containing KEY, SECRET, TOKEN, PASSWORD and the like, token-looking values, and URLs other than localhost always use the private box, even if the model supplies a value.

## v1.13.0

- New agent tool `request_env_var`: when a project needs an environment variable that is missing, the agent asks for it by name. A private box opens (masked, with a show button), you type the value, and it is written to `.env`. The value never reaches the chat or the model. Existing variables are never changed.
- Adding a variable also keeps `.env` out of Git (`.gitignore`) and lists the name, without a value, in `.env.example` when that file exists.

## v1.12.0

- Secret files are protected (Settings > Files > Protect secret files, on by default). `.env*`, keys (.pem, .key), credentials and similar files stay hidden from the agent and the chat. For `.env` files the agent sees variable names only. It cannot read, search or change them, but it can still run the project and tests that use them.
- Secret values are removed from terminal output (shown as ***), new secret files are never committed automatically, and the Files viewer masks them.
- After startup, a failed action shows a short message instead of a full-screen error page. The startup error page now follows dark mode and has a Reload button.
- Bigger touch areas for the copy, regenerate, report and row buttons (the look is unchanged).
- UI audit (tests/ui-audit.py): every screen at 320, 360 and 412 px wide in light and dark; no clipped text, no off-screen controls, icons centred on their labels.

## v1.11.0

- Git: repositories with symlinks now clone (a link is kept as a small file holding its target, and stays a link in commits). Editing an executable file no longer drops its executable bit.
- Git errors say what is wrong: token missing, rejected, no write permission, repository not found or private, file over 100 MB, protected branch, no connection, out of storage. Messages tell where to fix it.
- Git is faster on big repositories (object cache) and Stop now cancels a running clone, pull, fetch or push.
- Terminal: git clone, pull, fetch and push in Termux borrow the saved token for that one command only (GIT_ASKPASS). It is never stored in Termux, never shown to the model, and removed from output. Settings: Terminal > Git token for Termux (Lend or Never).
- Every git push asks, even in Auto mode.
- New agent tools: git_branch, git_fetch, git_remote. The agent now knows what the built-in Git can and cannot do, and when to use real git in Termux.
- Cloning from a chat now uses the current chat instead of opening a new one.

## v1.10.0

- Folder is no longer fixed to a chat. A folder chip sits above every chat ("Add folder" when none). Tap it to add, switch or remove the folder without losing the conversation.
- The model is told when the folder changes. "Always allow" permissions are cleared because they belonged to the old folder. Undo uses the folder each change was made in.
- Switching a chat that already has a folder asks: use here, or start a new chat. Each folder in the list also has a New chat button.
- Settings > Data: "Delete all conversations" (with confirmation). Folders, settings, memory and keys are kept.

## v1.9.0

- New logo everywhere: launcher icon (square and round), splash screen, setup screen, empty chat, drawer header, favicon and store icon.
- Full light and dark review of every screen. No layout or contrast bugs found; setup, drawer, projects, files, Git, thinking menu, Terminal, Settings, usage, approvals, plan card and Changes all checked in both modes with no page or console errors.

## v1.8.2
- The assistant now carries a short guide to the whole app: connecting a model, opening a project, Auto/Ask approvals, Git setup, and the one-time Termux setup (install, `allow-external-apps`, permission, storage). When someone asks for commands while the terminal is off, or a command fails because Termux is missing, it walks them through the missing steps.

### v1.18.0
- Short network or server failures (rate limit, busy server, dropped connection) are retried twice automatically before an error is shown, as long as nothing of the reply had arrived yet.
- Memory learning no longer sends almost every Bengali message to the model: the filter now needs a clear personal fact ("my name", "I live in", "remember...") instead of just "I" or "my". This cuts hidden token cost.
- Change backups are limited to the newest 60 per chat so storage no longer grows without limit.
- The agent is told to start working with sensible defaults and ask at most one short question, instead of listing questions.

### v1.17.1
- The Stop button now works while a terminal command is running (for example a long video conversion). It stops waiting at once, marks the command Cancelled, and sends a best-effort kill to Termux for that command and everything it started. Before, the app kept waiting until the command ended or timed out.

### v1.17.0
- The folder sheet now shows the path of every connected folder (the path Termux uses) with a Copy button, so it is clear which folder and path each project points to. Status text no longer gets cut off in these rows.

### v1.16.2
- Saving a file from the chat on the phone no longer relies on a browser-style download (the Android WebView may ignore it): the share sheet is tried first, and if it is unavailable the app asks for a folder and saves the file there, then releases that folder again.

### v1.16.1
- Attached text files now appear in the chat as a small file card (name and size) instead of pasting the whole file into the message. The model still receives the full content, and tapping the card saves the file back. Older chats are unchanged.

### v1.16.0
- New introduction and capability summary: the agent now describes itself as the KDex Agent built by Kamil Hussen from KDex, and lists what it can do (small projects, editing old code, bug finding, full Git, terminal work, everyday chat, memory) instead of listing limits.
- Chats without a folder can now create files: the agent calls `make_file` and the chat shows a Download / Copy card (share sheet on the phone, normal download in a browser). Folder chats are unchanged.
- The agent knows the app better: where to find New chat, folders, attachments, Memory, Token saving, Delete all conversations and Token usage, and that a memory is kept on the phone and shared across models.
- Text of the empty chat screen updated.

### v1.15.1
- The + button now opens a clean chat without a folder. Choose a folder for it from the folder button, or start a chat inside a project from the Projects list.

### v1.15.0
- The agent now handles environment variables the way big apps do: plain settings (PORT, HOST, NODE_ENV, APP_NAME, localhost URLs, LOG_LEVEL, TZ, sqlite paths) are added by the app itself with example values, without asking.
- Secrets (keys, tokens, passwords) are only requested: a private box per value ("1 of 3"), where you can type the value or skip. Skipped names are still listed empty in `.env.example`.
- One `request_env_var` call can cover every missing variable; existing values are never changed.
- The agent no longer asks about project type or defaults; it reads the project first.


### v1.19.0 – Git, professional
- Opening a folder that already has a Git repository (for example one made in Termux) now detects it: branch, tracking branch, remote (with HTTPS/SSH badge), last commit and author, repository author, data location, Git LFS, submodules and shallow clones. A Repository card in Git > Remote shows it, with one-tap fixes. Nothing is ever deleted or changed automatically.
- An empty Git name/email in the app is filled from the repository's own settings or last commit.
- SSH remotes (`git@github.com:user/repo.git`) can be switched to HTTPS in one tap, since the built-in Git works over HTTPS.
- Push refusals from GitHub (secret scanning, protected branch, rules) are explained in plain words with the file, the secret type and the unblock link, plus a Copy link button.
- Faster Git sheet: it opens at once with placeholders; branch, history and remote appear first, file changes follow.
- Operations show a progress bar with a friendly phase name and a Cancel button.

### v1.19.1
- Added `scripts/fix-blocked-push.sh`: combines local commits into one clean commit when GitHub blocks a push because an old commit contains a secret.

### v1.19.2
- Fixed `scripts/fix-blocked-push.sh` flagging itself.

### v1.19.3
- Fetch button now has its icon like Pull and Push.

### v1.20.0 – faster Git
- Folder access remembers folder ids, so a file operation no longer lists every parent folder again. Git writes many small files under .git/objects, so commit and push get much faster on big folders.
- Slow actions show how long they took.

### v1.21.0 – direct file access
- New optional "All files access" permission (asked once, also in Settings > Fast file access). With it the app reads and writes shared storage through normal file paths, like Termux, instead of Android folder access, which needs a content query per step. Files, search, edits and Git become much faster.
- Without the permission, or for folders outside shared storage, the previous folder access is used unchanged.

### v1.21.1
- Fetch icon now matches Pull and Push (same arrow style, size and weight).

### v1.21.2
- Fetch icon is now a cloud with a down arrow, in the same weight and size as Pull and Push.

### v1.22.0 – background work, native Git, safety and viewing
- **Background work:** while the agent works, a foreground service with a notification and a wake lock keeps the app running when the screen turns off. Android 13+ asks for the notification permission once.
- **Native Git (JGit):** status, commit, log, fetch, pull, push and full clones run in the JGit library on the phone when direct file access is on. Shallow clones, branches, checkout and merge still use the JavaScript Git. If native Git is unavailable the app falls back to JavaScript Git automatically. To build without JGit set the repository variable `KDEX_JGIT` to `0`. JGit needs Android 8 (minSdk 26).
- **Diagnostics log:** Settings > Help > Diagnostics log lists errors and failed Git actions. Tokens and keys are masked; Copy log is safe to share.
- **Secret scan:** before a commit, selected files are scanned for keys and tokens. You can leave the flagged files out or commit anyway. Values are never shown.
- **Syntax colours and file viewer:** code blocks in chat are coloured, and the Files viewer shows line numbers and colours, with Copy.

### v1.22.1 – notifications
- All notifications share one design: a short pill for one-line messages, a card with a title and detail for longer ones. Success, warning, error and info each have their own icon and colour, in light and dark. Tap to dismiss; errors stay a little longer.

### v1.22.2 – dependable and clearer
- **Network loss:** if the connection drops, the agent waits (up to 10 minutes) for it to return and asks again, also when it drops in the middle of a reply (the partial reply is discarded and requested again). Busy or rate-limited servers are retried twice.
- **Work finished:** a light vibration when the agent finishes or fails, and a notification when the app is in the background (tap it to return). Needs the new VIBRATE permission (normal, no prompt).
- **Notifications:** long details wrap to two lines, long URLs and paths are shortened in the middle, and tapping a card shows the full text with a Copy button.
- **Secret scan:** if more than 300 files are selected, you are told that the rest were not checked.

### v1.23.0 – diff, history and Git errors
- **Git diff:** tapping a changed file shows old and new line numbers, green added and red removed lines, changed words highlighted, and unchanged parts folded ("40 unchanged lines"). Very large files (over about 600 KB) and binary files skip the line view. The Changes list shows "+3 −1" under each file, filled in a few files at a time.
- **Change history:** Settings of each chat's Changes sheet now lists what the agent created, edited or deleted with Undo, Restore (deleted files) and Undo all. Tapping a row shows what changed.
- **Git errors:** a card with a plain title and explanation, plus a fix button where there is one (Pull now, Open token settings, Retry) and Copy details.

### v1.23.1
- Notifications follow the app theme (light card in light mode, dark card in dark mode) and can be swiped left, right or up to dismiss.
- The file viewer no longer shows PDFs, office files, images, archives and other non-text files as garbled text; it shows a short "Not a text or code file" card instead.

### v1.24.0 – open a folder by path
- New button "Open by path..." under "Open a folder...". Type or paste a path (`/storage/emulated/0/...`, `/sdcard/...`, an SD card under `/storage/XXXX-XXXX/...`, or a path relative to the storage root). The path is checked as you type: it must exist, be a folder and be readable. Then the folder opens like any other, with Files, Git and the agent.
- Needs "All files access" (the sheet offers to turn it on). Private app folders (`/data/...`, Termux home `~`) are not shared by Android and cannot be opened. Opening the whole storage asks for confirmation first.

### v1.25.0 – smarter AI, cleaner error cards
- AI plans first: for a task that changes more than two files, needs several commands or is vague, it writes a short plan and waits for your go. Small clear fixes are done directly.
- AI checks its own work: after changing files it reads the result back and runs the lightest test, lint or build when the terminal is available, then reports what it really checked.
- Project map: on each turn the AI gets a short map of the open folder (main file types, top folders, root files, package.json scripts). It is cached for 20 minutes and refreshed after any change. Secret files and folders such as node_modules and .git are left out.
- Git error cards no longer have Copy link, Copy details or Open token settings buttons (they did not work reliably in the Android WebView). The text states where to fix it, and can be selected with a long press. Pull now and Retry stay.

### v1.26.0 – quieter app, clearer feedback
- Quiet mode (Settings > Appearance > Notifications, default Quiet): popups that only repeat what the screen already shows are hidden (Token saved, Using folder, Auto mode changed, Git repository found, Committed, Fetched and similar). Errors, warnings and results of long tasks (push, pull, clone) still show. Choose "All" to see every popup again.
- Copy buttons now show "Copied" on the button itself (or a tick on icon buttons) instead of a popup.
- Git > Suggest: dimmed when no model is connected. Tapping it shows a red line right above the buttons ("Connect a model first: Settings > Add provider.") that clears after 5 seconds. Other suggest errors use the same line.
- Git > History: shows 10 commits, "Show 10 more" up to 30, then "End of history" or "Showing the latest 30".
- Git identity and tokens: Save returns to the previous screen. A token that is empty-host or too short or contains spaces stays on the screen with the reason under the Save button.
- Terminal setup card: every command in its own single-line box (scrolls sideways, one tap selects the whole command).

### v1.27.0 – calmer buttons
- Primary buttons keep the brand orange-to-pink but in deeper tones (#D8432C to #CC3A5E), so white text reaches about 4.5:1 contrast (it was 2.85:1 on the orange end). They are 48px tall with 14px corners instead of tall capsules.
- A selected option (segmented controls, active chips) now has a light pink tint, a pink border and pink text, so it is clear which one is chosen. Unselected options use muted text. Dark mode uses a lighter pink.
- Links and text accents use a darker pink (`--ink`) for readability.
- Fixed: a primary button briefly turned grey while pressed.

### v1.28.0 – offline line and a clearer Git card
- No connection while the agent is working: instead of a popup there is a quiet status line above the message box ("Offline. Waiting to reconnect..." with a spinner). It disappears by itself when the reply continues, so there is no "Back online" popup. After 5 minutes it says "Still waiting. Tap Stop to cancel." A busy provider uses the same line.
- Popup cards no longer have a Copy button. The text can be selected with a long press.
- Git sheet status tag: "N to push" (pink), "N to pull" (orange), "Up to date" (green), "Not pushed yet" for a branch without a remote copy.
- Git sheet branch card: the branch icon sits in a tile, centred against the branch name and the repository link. A long link is shortened in the middle (`github.com/owner/…/repo`) so the repository name stays visible; the full link is on the Remote tab.

### v1.29.0 – steadier chips, tidier Repository card
- The Auto and Terminal chips keep one fixed width, so tapping them no longer makes the chip row jump (Ask first / Auto, Terminal / Terminal on).
- Git > Remote > Repository card: a long value (over 34 characters, for example a repository link or an author line) moves under its label, left aligned, and breaks after a `/` instead of in the middle of a word. Short values stay beside the label as before. The text can be selected with a long press.

## v1.30.0
- Git changes list opens instantly: per-file +/- counts removed from rows, rows have a uniform height. Tap a file to see its diff with a sticky +N / -M summary on top.
- Terminal sheet: "Git token for Termux" is now "Use my Git token in Termux" with Allow / Never, and a clearer description.
- Terminal sheet: "Path in Termux" shows the full path in a wrapping, tap-to-select box.

## v1.31.0
- Git diff: binary files show their size change (`120 KB → 85 KB (−35 KB)`, `New · 85 KB`, `Deleted · 120 KB`). Text files show the size line above the diff. The old side of a binary file is no longer read as text.
- File viewer: images (png, jpg, gif, webp, bmp, ico, avif) open as a preview with dimensions and size. Large text files say how much is shown (`first 195 KB of 2.4 MB`).
- Diagnostics log: keeps the last 7 days and at most 200 entries. Agent runs are one line each, and routine run lines are dropped before errors and Git entries.
- Git identity and tokens: saved tokens first, then an "Add a token" card (button reads "Replace token" for a host that already has one), then Commit author with its own Save. Placeholder `root` / `root@localhost` values are treated as empty, and an author is required.

## v1.32.0
- Sheets: drag the grip or the title bar down to close any bottom sheet. A short drag springs back, a long drag or a quick flick closes it. Buttons, lists and text fields are not affected. Confirmation dialogs are unchanged.
- Terminal: the "Change path" button is gone. The path box shows "Detected automatically · Edit" or "Set by you · Edit · Reset". If no path can be found, a notice and a "Set path" button appear instead. Grant permission only shows while it is needed.

## v1.33.0
- Brand colour: the orange-pink gradient is replaced by one solid raspberry, `#D6334F`, taken from the logo (white text contrast 4.7:1). Dark theme uses a lighter `#FF7A92` for links, selected states and focus. Primary buttons, send button, chips, toggles, links, spinners and checkboxes all follow it.
- Legibility: Fetch, Push and Pull use full-strength text (a toggle rule had greyed them by mistake). Button and field borders are clearer, and muted text is darker in light theme and brighter in dark theme.
- Git summary buttons are now in the order Fetch, Push, Pull.
- Font: Inter (variable, Latin subset, about 48 KB, SIL Open Font License) is bundled so text weights look the same on every phone. Bangla text still uses the phone's own font.
