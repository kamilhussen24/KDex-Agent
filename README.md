<div align="center">

# KDex Agent

**A private AI coding assistant for your Android phone.**
Open a project folder, describe the change, review it as a diff, then commit and push with built-in Git.

[![Latest release](https://img.shields.io/github/v/release/kamilhussen24/KDex-Agent?label=release)](https://github.com/kamilhussen24/KDex-Agent/releases/latest)
![Platform](https://img.shields.io/badge/platform-Android%208%2B-3ddc84)
![License](https://img.shields.io/badge/license-source--available-D6334F)

</div>

Bring your own API key. No server, no account, no analytics: your keys, chats and files stay on your phone.

## Highlights

- **Your model, your key.** Anthropic, OpenAI, Gemini, DeepSeek, xAI, Groq, Mistral, OpenRouter or any OpenAI-compatible endpoint.
- **You stay in control.** Every file change is a diff you Apply or Reject. A backup is saved first and Undo is one tap.
- **Real project work.** The agent lists, searches, reads, creates and edits files, only inside the folder you choose.
- **Built-in code editor.** CodeMirror 6 with syntax colours, find and replace, line numbers and indent guides.
- **Git without a laptop.** Clone, commit, push, pull, branches and history for GitHub, GitLab and any https remote.
- **Safe by design.** Secret files are hidden from the AI, tokens live in the Android Keystore, and every push needs your approval.
- **Optional terminal.** Run commands through Termux, approving each one.
- **Works in the background.** Keeps going with the screen off and notifies you when it finishes or needs approval.

## Install

1. Open the [latest release](https://github.com/kamilhussen24/KDex-Agent/releases/latest) on your phone and download `KDex-Agent-release.apk`.
2. Open the file and allow installs from your browser or file manager (normal for apps outside Google Play).
3. Later updates install over the old version from **Settings > About > Check for updates**. Chats and settings stay.

## Quick start

1. Pick a provider, paste your API key and choose a model.
2. Tap **Add folder** and choose a project folder (Android does not allow the whole storage; pick a subfolder).
3. Ask for a change, review the diff and tap **Apply**. Use **Changes** to undo.

## Features

**Chat**
- Thinking levels, memory notes, searchable history, token saving and estimated cost.
- Attach images, text and code files, Word, Excel, PowerPoint and text-based PDF files, and work with ZIP archives.
- Reads a public web page when you ask for fresh information or give a link. You approve each site.

**Project folders**
- Diff viewer with changed words highlighted, file viewer and image preview.
- Create, rename, copy the path of and delete files and folders from the file list.
- The app reopens in the last chat or folder you used.
- Optional "All files access" for much faster file and Git work.

**Git**
- Status, diff, commit, push, pull, fetch, branches, history and discard.
- Start fresh history replaces old commits with one commit before you make a repository public.

**Safety**
- `.env`, keys and credentials are hidden from the AI and masked in output.
- Nothing is deleted without approval, and a likely secret in a commit is flagged before you push.

**Everyday**
- Share text, links or files from other apps into a chat.
- Backup and restore (API keys are never included), light and dark themes, and a private diagnostics log.

## Privacy and limits

- No server, accounts or analytics. See [PRIVACY.md](PRIVACY.md).
- Android 11 and newer do not let apps pick the storage root or the Download folder; choose a subfolder.
- Files over 1 MB are truncated when read, and binary files cannot be edited.
- Very large repositories can be slow on a phone.

## Contributing

Bug reports, ideas and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), which covers setup, architecture, conventions and releasing. Report security problems privately, see [SECURITY.md](SECURITY.md). Release notes are in [CHANGELOG.md](CHANGELOG.md).

## Build from source

Preview the interface in a browser (native features need a phone):
```
cd www && python3 -m http.server 8080
```
Build an APK: push your fork to GitHub and run **Actions > Build Android APK > Run workflow** with `debug`, then download the APK from the run's artifacts.

## License

KDex Agent is **source-available**, not open source in the OSI sense. You can read the code, use the app, change it for yourself and send improvements back. You may not redistribute it, publish it under your own name, or sell it. See [LICENSE](LICENSE) for the exact terms. Versions 1.38.0 and earlier were released under the MIT License. Third-party components keep their own licenses (Settings > About > Licenses).

Made by [Kamil Hussen (KDex)](https://kamildex.com).
