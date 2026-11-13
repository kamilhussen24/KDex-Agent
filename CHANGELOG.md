# Changelog

All notable changes to KDex Agent are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Each GitHub Release shows the entry
for its version.

## [Unreleased]

## [1.49.2]

### Added
- Command approval cards show a yellow "Outside the start folder" line, and "outside folder" in the footer, when a command touches a path outside the start folder (servers and Termux). It is only a note: it does not make the command risky.
- When a menu opens on a chat, a server file or a scratch file, the other rows fade and the pressed row stays clear.

### Changed
- The model selector now fills the whole space between the menu button and the folder button.

## [1.49.1]

### Added
- A long file name now shows a short form at the top of the file menu, with the start and the extension kept. Short names show nothing extra.
- Command output can be expanded when it is long, and a long table scrolls sideways instead of breaking.
- A command that prints a secret file (`.env`, private keys, `.netrc`) now shows a warning and always asks, because its output goes to your AI provider.

### Changed
- Command output uses a smaller font, so more fits on screen.
- The Terminal chip keeps one fixed width when you turn the terminal on or off, with no extra empty space.
- The model name has more room at the top. The new chat button at the top is gone; use New chat in the menu.
- The note in the server form now says that commands run with the permissions of the user and each one asks first.

### Fixed
- Harmless commands that end with `2>/dev/null` no longer show the red "can delete data" warning.
- Command output from a server no longer starts with the login banner of the server.
- After you send a message, the same text no longer comes back into the message box when the keyboard was still composing the last word. Sending the same text twice within four seconds is ignored.

## [1.49.0]

### Added
- **Connect a server** (SSH/SFTP). Add a server from the Projects sheet, test the connection, and use it like a folder.
- Browse, view, upload, download and delete files on the server, with progress and Cancel for large files.
- The agent can read and edit files on the server and run commands there. Every command asks first, and risky ones (stopping services, deleting databases, changing users or the firewall) get a warning.
- Password or private key sign-in. Passwords and keys are stored encrypted on the phone. The server's key is checked on every connection.
- Edit or remove a server from the Projects sheet.

### Changed
- Auto is off for servers, and the Git and Terminal chips are hidden there. The agent can still run commands on the server.

### Notes
- Ed25519 keys are not supported yet. Use a password, or an RSA or ECDSA key.
- FTP and FTPS are planned for a later release.

## [1.48.1]

### Added
- The Auto chip now shows next to the Scratch chip in a chat without a folder, so approvals can be set there too.
- Adding a folder to a chat that has Scratch files asks "Move N Scratch files?" with "Not now" and "Move".

### Changed
- The Move dialog is simpler: Cancel or Move. The files are copied, then Scratch is emptied. A file whose name already exists is kept as a copy with "-scratch" in its name, and a warning says so.
- Notifications: Quiet shows only errors, warnings and results you cannot see (Git, clone, restore, updates). All shows everything. Short confirmations (Auto on/off, Moved, Freed, Saved and similar) are now All only.
- While a notification is visible, the first touch anywhere only dismisses it. The next touch works normally.
- The reload button in the HTML preview bar uses a simpler single-arc icon.

### Fixed
- The chat long-press menu now closes with one tap instead of two.

## [1.48.0]

### Added
- Scratch: a chat without a folder now has a private file desk. It appears the first time a file is made (the "Scratch · N" chip next to Add folder) and is kept only inside the app, out of the file manager and away from other apps. The agent can now list, read, write, edit, delete, search, zip and unzip files there, with the same approvals and backups as a project. Files from make_file are saved there too, and the Download button still works as before. There is no Git or terminal in Scratch.
- Scratch sheet: tap a file for View, Copy, Preview (HTML) or Delete. Move to a folder copies the files into a folder you pick and continues the chat there (you choose to clear or keep the Scratch copy; files with the same name are kept). Download all (zip) goes through the phone's share sheet like other downloads. Clear this scratch empties it; the chat stays. Each chat's Scratch is limited to 50 MB and is deleted with the chat.
- Settings > Cleanup: shows what the app uses and what is safe to clear. Free up space removes undo backups older than 30 days, the diagnostics log and Scratch files of chats not used for 30 days. Remove pictures from chats deletes the pictures but keeps every message. Chats, keys and settings are never touched, and both buttons ask first.

### Changed
- The local database is now version 2 (adds the Scratch store). Existing chats and settings are untouched.

## [1.47.3]

### Changed
- Chat bar: the approval chip now always reads "Auto". Off is a plain outline with a shield; on is a red tint with a shield and a check. The chip never changes size, so nothing shifts when you switch. Tapping it explains the new state (shown in Quiet mode too).
- Git sheet: the Changes, Branches, History and Remote tabs are four equal outline pills across the full width, the same style as the other buttons in the app. Long labels such as "Changes (12)" still fit.

### Fixed
- The Pin, Rename and Delete menu now closes on the first touch outside it, also after opening it with a long press. The touch no longer reaches the chat underneath.

## [1.47.2]

### Changed
- Git sheet: the Changes, Branches, History and Remote tabs are now one rounded bar that fills the full width, matching the card below.
- Notifications follow one rule. Quiet (the default) shows only errors, warnings and results of long tasks such as push, pull, clone, backup and update. Short confirmations (Pinned, Copied, Saving, Committed, branch changes, saved keys and the like) appear only in All. The old hide-list is gone, so a new message can no longer slip into Quiet mode by accident.
- The "Pictures may not work" warning shows once per model instead of on every attached picture.
- Blocked actions (task still running, terminal off, file too large, backup problems) and model notices are now warnings, so Quiet mode never hides the reason something did not happen.
- Settings: the Notifications note now says what Quiet and All show.

## [1.47.1]

### Fixed
- Pressing and holding a chat in the drawer now opens the Pin, Rename and Delete menu on a real phone. It uses Android's own long press, ignores the system cancel signal, and no longer closes when you lift your finger.
- Changes screen: Delete, Restore and Undo buttons are now the same width.
- Chat bar: the Auto and Ask first chip keeps its icon in the same place when you switch.

### Changed
- Git sheet: Stage all, Unstage all and Discard all are now same-size chips. The safe actions are grey and Discard all is red with a trash icon.
- The assistant no longer mentions a website when it introduces itself.

## [1.47.0]

### Added
- HTML preview. Pages the agent creates in chat get an eye button next to Copy and Download, and `.html` files in the Files screen have one too (plus a Preview button in the file viewer). The page opens full screen in a closed box inside the app: scripts run, but it cannot reach the network, the app's data or your keys. Local CSS, scripts and pictures next to the page are loaded from the project folder. Reload and Save a copy are in the top bar.
- Press and hold a chat in the drawer to open the same Pin, Rename and Delete menu next to your finger. The three-dot button still works. Moving your finger (scrolling) cancels it, and releasing does not open the chat.

### Changed
- Git sheet footer: Commit is now one full-width button. Suggest moved into the commit message box as a small sparkles pill.

## [1.46.0]

### Added
- **Build status after a push:** a bar above the message box follows the GitHub Actions build of the commit you pushed (waiting, running, passed, failed). When it fails, **Fix it** makes the agent read the build log, fix the cause with small edits and commit. It asks before pushing again and stops after 3 tries in a row.
- **Pre-push check:** before every push the app checks package.json (valid JSON, valid dependency versions), that the version is the same in package.json, package-lock.json and the app's version constant, that package-lock.json matches package.json (the usual reason for a failed `npm ci`), and that the changes hold no merge-conflict marks or keys. If something is wrong the push card shows it with **Fix it** and **Push anyway**. The agent can also run it on its own (`pre_push_check`).
- **Safe version bump** (`bump_version`): raises the version in package.json, package-lock.json and APP_VERSION with exact, verified edits, so version numbers are never changed with a search-and-replace again.
- **One-tap release** (`release`): raises the version, writes the changelog entry from the notes, runs the pre-push check, commits "Release vX.Y.Z" and pushes, after one approval card. It always asks, even in Auto mode. It reads your workflow file first and stops with a clear message when the project publishes from a tag.
- **Saved commands** in the Terminal sheet: your own shortcuts per project. Run shows the command, asks first, runs it in Termux and shows the result, without using the model or tokens. Commands that contain a key or password are refused.
- **Review my changes:** a button in the Git sheet (and `review_changes` / `report_findings` for the agent) lists risks, leftovers and notes in your uncommitted changes with file and line and a **Fix** button on each. When nothing is wrong it says "No problems found".

### Fixed
- package-lock.json had the wrong version inside it (1.5.1); the version bump corrected it.
- "Allow all" no longer approves a push that the pre-push check held back.

## [1.45.1]

### Fixed
- Build failed at `npm ci`: the isomorphic-git version in package.json had been mangled (`^1.45.02`) by a version-bump script. Restored to `^1.44.12`. This also affected 1.44.2.

## [1.45.0]

### Added
- **Project instructions:** a `KDEX.md` file in the project folder is read at the start of every message (up to 4000 characters).
- **Project map** tool: every file with its functions, classes and routes in one call.
- **Project checks** tool: finds the project's lint, test and build commands so the agent can run the lightest one and fix errors.
- **Loop guard:** the agent stops and asks when it repeats the same step with the same result, or fails four times in a row.
- **Undo all** bar after a task that changed two or more files, with a Review shortcut.
- **GitHub tools:** read Actions runs, explain why a build failed from the log, list issues and pull requests (read-only; uses the saved Git token without exposing it).
- **Termux setup checker:** shows which programs are installed and how much space is free, with install commands.
- **Everyday tools:** calculator, unit converter, `remember` (saves a note), clipboard read and write, alarm and timer in the phone's Clock app.
- **Image generation** (Settings > Images): creates a picture with your own image-model key and saves it in the project folder, after your approval.
- Screenshot-to-fix and file-conversion guidance for the agent.

### Changed
- Redirects are now followed by the app itself in `web_fetch` and the GitHub tools, so each hop is checked and tokens are never sent to another host.
- Added the `SET_ALARM` permission for the Clock app.

## [1.44.2]

### Fixed
- Tapping a chat row while its ⋮ menu is open now only closes the menu on touch screens; it no longer also opens the chat underneath.

## [1.44.1]

### Fixed
- Light mode: the status bar and the bottom bar showed black because the light background colour was sent to Android in a short form it rejects. They are now white with dark icons.
- Chat menu: while it is open, the first tap outside only closes it. It no longer opens the chat underneath.
- Rename chat starts with the current name, cursor at the end, so you can edit it.
- The splash logo has rounded corners, like the logo on the welcome screen.

## [1.44.0]

### Added
- Splash screen with the app logo on white or near-black, following the phone's light or dark mode.
- After two approvals in one chat, a web page request offers "Allow every website" so it stops asking.

### Changed
- Reading a web page has its own card: "Read web page", the site and page, a short status (Waiting, Done, Skipped, Couldn't read) and the reason when it fails.
- The approval bar says "1 waiting for your approval" with an "Allow all" button.
- The context dialog is shorter.

## [1.43.0]

### Added
- Chats: a menu button on every chat with Pin, Rename and Delete. Pinned chats stay on top under "Pinned" and survive "Delete all conversations".
- Folders: the folder list is sorted by last use and shows "Opened ... ago"; a search box appears once there are six or more folders.

### Changed
- The trash button in the chat list moved into the chat menu, so a chat can no longer be deleted by one stray tap.

## [1.42.1]

### Fixed
- Pull: the merge commit Git makes when both sides changed now uses your Git name and email (it used the phone's system user before).
- Push and pull on a detached HEAD now say clearly to switch to a branch first.

## [1.42.0]

### Security
- The `.git` folder is hidden from the AI's read, search and file-find tools; it can hold access tokens. Git tools remain available.
- Credentials inside URLs (`https://user:token@host`) are masked in tool output.
- Terminal commands that send data out (curl/wget uploads, POST, auth headers, nc/scp/rsync, reads of Git credential files) always ask first, even in Auto mode. Plain downloads are unaffected.
- The update check only accepts APK links from this project's GitHub repository.

### Fixed
- Backup and restore are safer: backups leave pictures out (with a note in the message), a damaged file is rejected before anything is changed, and a failed restore rolls back to the previous data.
- After a reinstall, folders Android no longer lets the app open are listed so you can add them again.

### Changed
- Android versionCode is derived from the version number, and a release tag must match the version in package.json.

## [1.41.0]

### Added
- **Read web pages:** the assistant can read one public web page (`web_fetch`) when the answer needs fresh information such as news, new versions, prices or documentation, or when you give it a link. It needs no key and no third-party service: the phone downloads the page, removes menus, scripts and ads, and returns about 6,000 characters at a time to save tokens. You approve each new site (with "Always allow this site in this chat"), and addresses on this phone or a private network are blocked.
- **Look at pictures in a project folder:** the assistant can view a png, jpg, webp or gif file from the folder (`view_image`) when seeing it matters.
- **Direct answers to "what is it today?" questions:** exchange rates, crypto prices, weather and similar live facts are fetched at once from one simple source (a single terminal command when Termux is on, otherwise `web_fetch`), and the answer gives the value first, then the source and how fresh it is. Money rates are labelled as reference rates.
- **Context ring:** a small ring next to the attach and thinking icons shows how full the chat history is for your token-saving mode (green, yellow, red). Tap it for details or to start a new chat.
- A short warning when you attach a picture to a model that is probably text-only, and a clear message if a provider refuses pictures.

### Fixed
- If a model refuses a request because its own context limit is smaller than the chosen budget, the app now retries with less history instead of stopping with an error.
- Long unbroken terminal output (such as JSON) is wrapped instead of being cut off at the right edge.
- Pictures and screenshots sometimes arrived black. Small pictures are now sent exactly as they are; larger ones are resized on a white background, and if the result looks blank the original is sent instead.

## [1.40.0]

### Added
- Attach Word (.docx), Excel (.xlsx), PowerPoint (.pptx) and OpenDocument files to a chat; their text is read on the phone. PDF is not supported.
- The assistant knows what to install in Termux for common project types, with rough download sizes, and avoids heavy tools.

### Changed
- Shorter answers: "who are you" gets a one-line introduction and a few short bullets in the language of the question; greetings get one short line. Replies follow the language of the latest message.
- Long chats: the running summary keeps the current state and the next step (up to 450 words), and the assistant re-reads files that may have changed since an earlier session.
- Switching model in the middle of a chat is safer: provider-specific thinking data is only sent back to the model that wrote it.
- The assistant only explains app settings when asked or when something goes wrong.

## [1.39.0]

### Added
- Project documentation: new README, `CONTRIBUTING.md`, `SECURITY.md`, issue and pull request templates.
- This changelog. Release notes on GitHub now come from it.

### Changed
- License: KDex Agent is now source-available under the KDex Agent License (see `LICENSE`). Versions 1.38.0 and earlier stay under the MIT License.
- Privacy policy updated to match the app (update check, Git storage, Termux, backups).
- Settings > About now has a "Licenses" screen that lists the app license and third-party licenses.

### Removed
- Development-only files from the repository (tests, screenshots, store checklist, helper script).

## [1.38.0]

First public release.

### Added
- Chat with your own AI provider key (Anthropic, OpenAI, Gemini, DeepSeek, xAI, OpenRouter or any OpenAI-compatible endpoint), thinking levels, memory notes, chat history and usage estimates.
- Project folders: the agent lists, searches, reads, creates, edits and deletes files only inside the folder you choose. Every change is shown as a diff and needs your approval; a backup is saved first and Undo is one tap.
- Git built in: clone, status, diff, commit, push, pull, fetch, branches, history and discard, with access tokens kept in the Android Keystore.
- Optional Termux terminal for commands, with approval for each command.
- Protection for secret files (`.env`, keys): hidden from the agent and the chat.
- Background work with notifications, approval notifications, and Share into the app.
- Backup and restore (API keys are never included), light and dark themes, diagnostics log.
- Settings > About: developer, source code, update check against GitHub Releases.
- Automatic tag and GitHub Release when `version` in `package.json` is raised on `main`.
