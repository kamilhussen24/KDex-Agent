# Changelog

All notable changes to KDex Agent are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Each GitHub Release shows the entry
for its version.

## [Unreleased]

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
