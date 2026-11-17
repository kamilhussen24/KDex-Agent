# KDex Agent - Privacy Policy

Last updated: 2026-11-12

KDex Agent is an Android app that can work inside a folder you choose. It has no server, no user accounts, no analytics and no advertising. The developer does not receive your data.

## What stays on your phone
- Your chats, memory notes, settings, usage numbers, file backups and the diagnostics log are stored only on your device.
- Your API keys and Git access tokens are stored encrypted with the Android Keystore. They are never sent to the developer.
- Git repositories you clone or create keep their history in a `.git` folder inside your project folder, on your phone.
- Backups you create (Settings > Data) are saved in the folder you pick. They never include API keys.
- Notifications ("done", "needs your approval") are created on the phone and contain no chat text.

## What leaves your phone, and only when you use the feature
- **AI provider:** when you send a message, the text, attached or shared files and images, and any file contents the assistant reads from your project folder are sent directly to the AI provider you configured (for example Anthropic, OpenAI, Gemini, DeepSeek, xAI, Groq, Mistral, OpenRouter or a custom endpoint). Their privacy policies apply to that data.
- **Web pages (only when the assistant reads one):** when you approve a site, the phone requests that web page directly, so the site can see your IP address and the address you asked for. The page text is then sent to your AI provider as part of the chat. Nothing from your files or keys is added to the request, and each new site needs your approval.
- **Git host:** when you clone, pull, fetch or push, requests go to the Git host you enter (for example GitHub or GitLab), with your token.
- **Update check:** the app asks GitHub's public releases page (api.github.com) for the latest version, about once a day and when you tap "Check for updates". This is an ordinary web request, so GitHub can see your IP address. No chats, files or keys are sent.
- **Termux (optional):** if you turn the terminal on, commands you approve run in the Termux app on your phone. For a Git command in Termux, your saved token is lent to that one command only and is not stored in Termux.
- **Servers (optional):** if you connect a server, the app talks to it directly over SSH/SFTP from your phone. Its password or private key is stored encrypted on the phone and is never sent anywhere else. Files the agent reads from the server are sent to your AI provider like any other file.

## Folder access
The app reads or changes files only inside the folder you pick, and only when you ask. Every change needs your approval unless you turn on automatic apply, and a backup is saved before each change. Git push always asks. Files such as `.env` and keys are hidden from the AI and the chat. You can remove a folder at any time in Projects.

## Reporting content
AI replies can be wrong or inappropriate. The flag button under a reply marks it on your phone. If the developer has set a support address in the app, an email draft opens so you can send it; nothing is sent unless you send it.

## Your control
Delete a chat in the chat list, remove a provider or token in Settings, delete your backups from the folder where you saved them, or uninstall the app to delete everything it stores.

## Children
The app is not directed to children under 13.

## Changes
If this policy changes, the new version is published in the repository and the date above is updated.

## Contact
KDex - https://kamildex.com, support@kamildex.com, or open an issue at https://github.com/kamilhussen24/KDex-Agent/issues (do not post keys or private data).
