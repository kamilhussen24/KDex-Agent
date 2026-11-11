// Run after `npx cap add android` (or `cap sync`). Patches the generated Android project:
// native plugin, MainActivity, icons, splash, version, backup flag and (optional) release signing.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const android = path.join(root, 'android');
if (!fs.existsSync(android)) { console.error('android/ not found. Run "npx cap add android" first.'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const versionName = process.env.APP_VERSION || pkg.version || '1.0.0';
const versionCode = Number(process.env.APP_VERSION_CODE || process.env.GITHUB_RUN_NUMBER || 1);
const res = path.join(android, 'app/src/main/res');
const javaDir = path.join(android, 'app/src/main/java/com/kdex/agent');
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, t) => fs.writeFileSync(p, t);

// 1. native plugin + MainActivity
fs.mkdirSync(javaDir, { recursive: true });
fs.copyFileSync(path.join(root, 'native/KdexNativePlugin.java'), path.join(javaDir, 'KdexNativePlugin.java'));
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

// 4. manifest: no cloud backup of chats/keys
const mf = path.join(android, 'app/src/main/AndroidManifest.xml');
let m = read(mf);
m = m.replace('android:allowBackup="true"', 'android:allowBackup="false"');
// Optional Termux bridge: permission + package visibility (Android 11+)
if (!m.includes('com.termux.permission.RUN_COMMAND')) {
  m = m.replace('<application', '<uses-permission android:name="com.termux.permission.RUN_COMMAND" />\n    <queries>\n        <package android:name="com.termux" />\n    </queries>\n    <application');
}
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
write(gf, g);

console.log(`Prepared Android project: version ${versionName} (${versionCode}), ${splashCount} splash files, signing ${process.env.KDEX_KEYSTORE ? 'on' : 'off'}`);
