# Google Play checklist for KDex Agent

1. Developer account (one-time fee). New personal accounts normally need a closed test with at least 12 testers for 14 days before production.
2. Build: GitHub Actions > Build Android APK > build_type = release-aab. Upload the .aab to Play Console (turn on Play App Signing; your keystore is the upload key).
3. Store listing: short description (80 chars), full description, 512x512 icon, 1024x500 feature graphic, 2-8 phone screenshots.
4. App content forms:
   - Privacy policy: host PRIVACY.md as a web page (for example kamildex.com/agent/privacy) and paste the URL.
   - Data safety: no data collected or shared by the developer. Note that user content is sent to the AI provider the user configures.
   - Content rating questionnaire: AI chat app, user-generated content = AI generated. In-app reporting: the flag button under each reply.
   - Ads: none. Target audience: 13+ (or 18+).
5. Permissions: the app declares only INTERNET. Folder access uses Android's folder picker, so no storage permission or "all files access" is requested.
6. Set SUPPORT_EMAIL in www/js/config.js so reports open an email draft.

Suggested short description: Chat with AI and let it edit your project folders and Git repos.
