// Run after `npx cap add android` (or `cap sync`). Patches the generated Android project:
// native plugin, MainActivity, icons, splash, version, backup flag and (optional) release signing.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const android = path.join(root, 'android');
if (!fs.existsSync(android)) { console.error('android/ not found. Run "npx cap add android" first.'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const versionName = process.env.APP_VERSION || pkg.version || '1.0.0';
// versionCode comes from the version number (1.42.0 -> 1042000), so it always rises with the version
// and never depends on how many times the workflow ran.
const vm = /^(\d+)\.(\d+)\.(\d+)/.exec(versionName);
const fromVersion = vm ? Number(vm[1]) * 1000000 + Number(vm[2]) * 1000 + Number(vm[3]) : 1;
const versionCode = Number(process.env.APP_VERSION_CODE || fromVersion);
const res = path.join(android, 'app/src/main/res');
const javaDir = path.join(android, 'app/src/main/java/com/kdex/agent');
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, t) => fs.writeFileSync(p, t);

// 1. native plugin + MainActivity
fs.mkdirSync(javaDir, { recursive: true });
fs.copyFileSync(path.join(root, 'native/KdexNativePlugin.java'), path.join(javaDir, 'KdexNativePlugin.java'));
fs.copyFileSync(path.join(root, 'native/KdexWorkService.java'), path.join(javaDir, 'KdexWorkService.java'));
// Fast native Git (JGit). Set KDEX_JGIT=0 to build without it; the app then uses its JavaScript Git.
const useJgit = process.env.KDEX_JGIT !== '0';
if (useJgit) fs.copyFileSync(path.join(root, 'native/KdexGit.java'), path.join(javaDir, 'KdexGit.java'));
write(path.join(javaDir, 'MainActivity.java'),
`package com.kdex.agent;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KdexNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);

// 2. icons (plain PNG launcher icons; drop the adaptive-icon XML so the PNGs are used everywhere)
const icons = path.join(root, 'assets/icons');
for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  const dir = path.join(res, 'mipmap-' + d);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(icons, `ic_launcher-${d}.png`), path.join(dir, 'ic_launcher.png'));
  fs.copyFileSync(path.join(icons, `ic_launcher_round-${d}.png`), path.join(dir, 'ic_launcher_round.png'));
  fs.rmSync(path.join(dir, 'ic_launcher_foreground.png'), { force: true });
}
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });

// 3. splash: overwrite every splash.png the template ships
let splashCount = 0;
for (const dir of fs.readdirSync(res)) {
  const f = path.join(res, dir, 'splash.png');
  if (dir.startsWith('drawable') && fs.existsSync(f)) { fs.copyFileSync(path.join(icons, 'splash.png'), f); splashCount++; }
}

// 3b. splash that follows the phone's light or dark mode: the app logo, centred, on white or near-black.
// Android 12+ draws windowSplashScreenAnimatedIcon inside a circle, so the logo has its own padding (splash-logo.png).
fs.mkdirSync(path.join(res, 'values-night'), { recursive: true });
fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true });
fs.copyFileSync(path.join(icons, 'splash-logo.png'), path.join(res, 'drawable-nodpi', 'kdex_splash_logo.png'));
write(path.join(res, 'values/kdex_splash_colors.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="kdex_splash_bg">#FFFFFF</color>\n</resources>\n');
write(path.join(res, 'values-night/kdex_splash_colors.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="kdex_splash_bg">#121214</color>\n</resources>\n');
write(path.join(res, 'drawable/kdex_splash.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n    <item android:drawable="@color/kdex_splash_bg" />\n    <item>\n        <bitmap android:src="@drawable/kdex_splash_logo" android:gravity="center" />\n    </item>\n</layer-list>\n');
const stylesFile = path.join(res, 'values/styles.xml');
let st = read(stylesFile);
if (!st.includes('kdex_splash')) {
  st = st.replace(/(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)([\s\S]*?)(<\/style>)/, (m0, a, body, z) =>
    a + '\n        <item name="android:background">@drawable/kdex_splash</item>\n        <item name="windowSplashScreenBackground">@color/kdex_splash_bg</item>\n        <item name="windowSplashScreenAnimatedIcon">@drawable/kdex_splash_logo</item>\n    ' + z);
  write(stylesFile, st);
  console.log(st.includes('windowSplashScreenAnimatedIcon') ? 'Splash theme patched' : 'WARNING: splash theme not patched');
}

// 4. manifest: no cloud backup of chats/keys
const mf = path.join(android, 'app/src/main/AndroidManifest.xml');
let m = read(mf);
m = m.replace('android:allowBackup="true"', 'android:allowBackup="false"');
// Optional Termux bridge: permission + package visibility (Android 11+)
if (!m.includes('com.termux.permission.RUN_COMMAND')) {
  m = m.replace('<application', '<uses-permission android:name="com.termux.permission.RUN_COMMAND" />\n    <queries>\n        <package android:name="com.termux" />\n    </queries>\n    <application');
}
// Fast direct file access (Termux-style). The user grants it once in Android settings; without it the app falls back to the slower folder access.
if (!m.includes('MANAGE_EXTERNAL_STORAGE')) {
  m = m.replace('<application', '<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />\n    <application');
}
// Keep working with the screen off: foreground service (notification) + wake lock
for (const perm of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_DATA_SYNC', 'POST_NOTIFICATIONS', 'WAKE_LOCK', 'VIBRATE']) {
  if (!m.includes('android.permission.' + perm + '"')) m = m.replace('<application', '<uses-permission android:name="android.permission.' + perm + '" />\n    <application');
}
// Share into the app: text, links and text-like files from other apps
if (!m.includes('android.intent.action.SEND"')) {
  const filters = ['android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE'].map((a) =>
    '            <intent-filter>\n                <action android:name="' + a + '" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <data android:mimeType="text/*" />\n                <data android:mimeType="application/*" />\n            </intent-filter>\n').join('');
  m = m.replace('</activity>', filters + '        </activity>');
}
if (!m.includes('KdexWorkService')) m = m.replace('</application>', '    <service android:name=".KdexWorkService" android:exported="false" android:foregroundServiceType="dataSync" />\n    </application>');
write(mf, m);

// 5. gradle: version + optional release signing
const gf = path.join(android, 'app/build.gradle');
let g = read(gf);
g = g.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`).replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
if (process.env.KDEX_KEYSTORE) {
  if (!g.includes('signingConfigs')) {
    g = g.replace('    buildTypes {',
`    signingConfigs {
        release {
            storeFile file(System.getenv("KDEX_KEYSTORE"))
            storePassword System.getenv("KDEX_KEYSTORE_PASSWORD")
            keyAlias System.getenv("KDEX_KEY_ALIAS")
            keyPassword System.getenv("KDEX_KEY_PASSWORD")
        }
    }
    buildTypes {`);
    g = g.replace(/release\s*\{\s*\n(\s*)minifyEnabled false/, (s, ind) => `release {\n${ind}signingConfig signingConfigs.release\n${ind}minifyEnabled false`);
  }
  if (!g.includes('signingConfig signingConfigs.release')) { console.error('Could not patch release signing into app/build.gradle'); process.exit(1); }
}
if (useJgit && !g.includes('org.eclipse.jgit')) {
  g = g.replace(/dependencies\s*\{/, "dependencies {\n    implementation 'org.eclipse.jgit:org.eclipse.jgit:5.13.3.202401111512-r'");
  g = g.replace(/android\s*\{/, "android {\n    packaging {\n        resources {\n            excludes += ['META-INF/DEPENDENCIES', 'META-INF/LICENSE', 'META-INF/LICENSE.txt', 'META-INF/NOTICE', 'META-INF/NOTICE.txt', 'META-INF/*.SF', 'META-INF/*.DSA', 'META-INF/*.RSA', 'plugin.properties', 'about.html']\n        }\n    }");
}
write(gf, g);
// JGit needs java.nio.file and java.time: Android 8.0 (API 26) or newer
if (useJgit) {
  const vf = path.join(android, 'variables.gradle');
  if (fs.existsSync(vf)) write(vf, read(vf).replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 26'));
}

console.log(`JGit ${useJgit ? 'on' : 'off'}`);
console.log(`Prepared Android project: version ${versionName} (${versionCode}), ${splashCount} splash files, signing ${process.env.KDEX_KEYSTORE ? 'on' : 'off'}`);
