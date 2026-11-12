package com.kdex.agent;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.app.PendingIntent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import android.graphics.Color;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Native helpers for KDex Agent:
 *  - secure key storage (Android Keystore, AES-GCM)
 *  - streaming HTTP (no CORS, works for server-sent events)
 *  - folder access through the Storage Access Framework (the user picks a folder; nothing else is reachable)
 */
@CapacitorPlugin(name = "KdexNative", permissions = {
        @Permission(strings = {"com.termux.permission.RUN_COMMAND"}, alias = "termux")
})
public class KdexNativePlugin extends Plugin {

    private static final String KEY_ALIAS = "kdex_chat_key";
    private static final String PREFS = "kdex_secure";
    private static final int MAX_READ_BYTES = 1024 * 1024;
    private static final long MAX_BYTES_FILE = 64L * 1024 * 1024;
    private static final Set<String> SKIP_DIRS = new HashSet<>(Arrays.asList(
            ".git", "node_modules", ".gradle", "__pycache__", ".venv", "venv", ".idea", ".cache"));

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> connections = new ConcurrentHashMap<>();

    // ------------------------------------------------------------------ Termux bridge (optional, off by default)

    private static final String TERMUX_PKG = "com.termux";
    private static final String TERMUX_HOME = "/data/data/com.termux/files/home";
    private static final String TERMUX_BIN = "/data/data/com.termux/files/usr/bin";

    private JSObject termuxState() {
        JSObject o = new JSObject();
        boolean installed = false;
        try { getContext().getPackageManager().getPackageInfo(TERMUX_PKG, 0); installed = true; } catch (Exception e) { /* not installed */ }
        o.put("installed", installed);
        o.put("granted", getPermissionState("termux") == PermissionState.GRANTED);
        return o;
    }

    /** Colours the system status and navigation bars to match the app theme. */
    @PluginMethod
    public void setBars(final PluginCall call) {
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        final String hex = call.getString("color", dark ? "#121214" : "#FFFFFF");
        getActivity().runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    int c = Color.parseColor(hex);
                    Window w = getActivity().getWindow();
                    w.setStatusBarColor(c);
                    w.setNavigationBarColor(c);
                    WindowInsetsControllerCompat ctl = WindowCompat.getInsetsController(w, w.getDecorView());
                    ctl.setAppearanceLightStatusBars(!dark);
                    ctl.setAppearanceLightNavigationBars(!dark);
                    call.resolve();
                } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
            }
        });
    }

    @PluginMethod
    public void termuxStatus(PluginCall call) { call.resolve(termuxState()); }

    @PluginMethod
    public void termuxPermission(PluginCall call) {
        if (getPermissionState("termux") == PermissionState.GRANTED) { call.resolve(termuxState()); return; }
        requestPermissionForAlias("termux", call, "termuxPermResult");
    }

    @PermissionCallback
    private void termuxPermResult(PluginCall call) { call.resolve(termuxState()); }

    /** Runs one command in Termux (background mode) and returns { stdout, stderr, exitCode }. */
    @PluginMethod
    public void termuxRun(PluginCall call) {
        final String command = call.getString("command", "");
        final String cwd = call.getString("cwd", TERMUX_HOME);
        Long t = call.getLong("timeoutMs", 120000L);
        final long timeout = Math.max(1000L, Math.min(t == null ? 120000L : t, 600000L));
        if (command.trim().isEmpty()) { call.reject("No command."); return; }
        if (getPermissionState("termux") != PermissionState.GRANTED) { call.reject("Permission \"Run commands in Termux\" is not granted."); return; }

        final Context ctx = getContext();
        final String action = "com.kdex.agent.TERMUX_RESULT." + System.nanoTime();
        final Handler handler = new Handler(Looper.getMainLooper());
        final boolean[] done = {false};

        final BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent in) {
                if (done[0]) return;
                done[0] = true;
                handler.removeCallbacksAndMessages(null);
                try { ctx.unregisterReceiver(this); } catch (Exception e) { /* already gone */ }
                Bundle b = in.getBundleExtra("result");
                if (b == null) { call.reject("Termux returned no result. In Termux set allow-external-apps=true in ~/.termux/termux.properties and restart it."); return; }
                JSObject o = new JSObject();
                o.put("stdout", b.getString("stdout", ""));
                o.put("stderr", b.getString("stderr", ""));
                o.put("exitCode", b.getInt("exitCode", -1));
                String em = b.getString("errmsg", "");
                if (em != null && !em.isEmpty()) o.put("errmsg", em);
                call.resolve(o);
            }
        };
        IntentFilter filter = new IntentFilter(action);
        if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else ctx.registerReceiver(receiver, filter);

        try {
            Intent back = new Intent(action).setPackage(ctx.getPackageName());
            int flags = PendingIntent.FLAG_ONE_SHOT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, (int) (System.nanoTime() & 0x7fffffff), back, flags);

            String script = "export HOME=" + TERMUX_HOME + "; export PATH=" + TERMUX_BIN + ":$PATH; " + command;
            Intent run = new Intent("com.termux.RUN_COMMAND");
            run.setClassName(TERMUX_PKG, "com.termux.app.RunCommandService");
            run.putExtra("com.termux.RUN_COMMAND_PATH", TERMUX_BIN + "/bash");
            run.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", script});
            run.putExtra("com.termux.RUN_COMMAND_WORKDIR", cwd);
            run.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            run.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pi);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(run); else ctx.startService(run);
        } catch (Exception e) {
            done[0] = true;
            try { ctx.unregisterReceiver(receiver); } catch (Exception ignore) { /* ignore */ }
            call.reject("Could not reach Termux: " + e.getMessage() + ". Check that Termux is installed, allow-external-apps=true is set, and the permission is granted.");
            return;
        }
        handler.postDelayed(() -> {
            if (done[0]) return;
            done[0] = true;
            try { ctx.unregisterReceiver(receiver); } catch (Exception e) { /* ignore */ }
            call.reject("The command did not finish within " + (timeout / 1000) + " seconds. It may still be running in Termux.");
        }, timeout);
    }

    // ------------------------------------------------------------------ secure storage

    private SecretKey secretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(KEY_ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            return kg.generateKey();
        }
        return (SecretKey) ks.getKey(KEY_ALIAS, null);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        try {
            String key = call.getString("key");
            String value = call.getString("value");
            if (key == null || value == null) { call.reject("key and value required"); return; }
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String packed = Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
            prefs().edit().putString(key, packed).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("secureSet failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            String key = call.getString("key");
            String packed = key == null ? null : prefs().getString(key, null);
            if (packed == null) { ret.put("value", JSObject.NULL); call.resolve(ret); return; }
            String[] parts = packed.split(":");
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            byte[] pt = c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
            ret.put("value", new String(pt, StandardCharsets.UTF_8));
        } catch (Exception e) {
            ret.put("value", JSObject.NULL); // unreadable (for example after a restore): treat as missing
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String key = call.getString("key");
        if (key != null) prefs().edit().remove(key).apply();
        call.resolve();
    }

    // ------------------------------------------------------------------ streaming HTTP

    @PluginMethod
    public void httpStart(PluginCall call) {
        final String id = call.getString("id");
        final String url = call.getString("url");
        final String method = call.getString("method", "POST");
        final String body = call.getString("body");
        final String bodyB64 = call.getString("bodyB64");
        final JSObject headers = call.getObject("headers", new JSObject());
        if (id == null || url == null) { call.reject("id and url required"); return; }
        call.resolve();

        pool.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                connections.put(id, c);
                c.setRequestMethod(method);
                c.setConnectTimeout(30000);
                c.setReadTimeout(300000);
                Iterator<String> it = headers.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    String v = headers.getString(k);
                    if (v != null) c.setRequestProperty(k, v);
                }
                if ((body != null || bodyB64 != null) && !"GET".equals(method)) {
                    c.setDoOutput(true);
                    byte[] bytes = bodyB64 != null ? Base64.decode(bodyB64, Base64.DEFAULT) : body.getBytes(StandardCharsets.UTF_8);
                    c.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream os = c.getOutputStream()) { os.write(bytes); }
                }
                int status = c.getResponseCode();
                JSObject head = new JSObject();
                head.put("id", id);
                head.put("type", "head");
                head.put("status", status);
                head.put("contentType", c.getContentType());
                JSObject hdrs = new JSObject();
                for (Map.Entry<String, List<String>> he : c.getHeaderFields().entrySet()) {
                    if (he.getKey() == null) continue;
                    hdrs.put(he.getKey().toLowerCase(), android.text.TextUtils.join(", ", he.getValue()));
                }
                head.put("headers", hdrs);
                notifyListeners("http", head);

                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in != null) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        if (n == 0) continue;
                        JSObject ev = new JSObject();
                        ev.put("id", id);
                        ev.put("type", "chunk");
                        ev.put("b64", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
                        notifyListeners("http", ev);
                    }
                }
                JSObject end = new JSObject();
                end.put("id", id);
                end.put("type", "end");
                notifyListeners("http", end);
            } catch (Exception e) {
                JSObject err = new JSObject();
                err.put("id", id);
                err.put("type", "error");
                err.put("message", String.valueOf(e.getMessage()));
                notifyListeners("http", err);
            } finally {
                connections.remove(id);
                if (c != null) c.disconnect();
            }
        });
    }

    @PluginMethod
    public void httpCancel(PluginCall call) {
        String id = call.getString("id");
        HttpURLConnection c = id == null ? null : connections.get(id);
        if (c != null) {
            final HttpURLConnection cc = c;
            pool.execute(cc::disconnect);
        }
        call.resolve();
    }

    // ------------------------------------------------------------------ folder access (SAF)

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, i, "folderResult");
    }

    @ActivityCallback
    private void folderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            call.reject("Could not keep access to this folder: " + e.getMessage());
            return;
        }
        String docId = DocumentsContract.getTreeDocumentId(uri);
        String name = docId;
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        int colon = name.lastIndexOf(':');
        if (colon >= 0 && colon < name.length() - 1) name = name.substring(colon + 1);
        if (name.isEmpty()) name = "Folder";
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("name", name);
        ret.put("path", docId);
        call.resolve(ret);
    }

    @PluginMethod
    public void releaseFolder(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri", ""));
            getContext().getContentResolver().releasePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) { /* ignore */ }
        call.resolve();
    }

    private static class Doc {
        String id; String name; String mime; long size; long modified; boolean dir;
    }

    private ContentResolver resolver() { return getContext().getContentResolver(); }

    private List<Doc> children(Uri tree, String parentId) {
        List<Doc> out = new ArrayList<>();
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        Cursor c = null;
        try {
            c = resolver().query(kids, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null);
            if (c == null) return out;
            while (c.moveToNext()) {
                Doc d = new Doc();
                d.id = c.getString(0);
                d.name = c.getString(1);
                d.mime = c.getString(2);
                d.size = c.isNull(3) ? 0 : c.getLong(3);
                d.modified = c.isNull(4) ? 0 : c.getLong(4);
                d.dir = DocumentsContract.Document.MIME_TYPE_DIR.equals(d.mime);
                out.add(d);
            }
        } finally {
            if (c != null) c.close();
        }
        return out;
    }

    private String[] splitPath(String rel) throws Exception {
        List<String> parts = new ArrayList<>();
        if (rel != null) {
            for (String p : rel.split("/")) {
                if (p.isEmpty() || p.equals(".")) continue;
                if (p.equals("..")) throw new Exception("Path must stay inside the chosen folder");
                parts.add(p);
            }
        }
        return parts.toArray(new String[0]);
    }

    // Folder ids already looked up, keyed by tree + path. A deep path such as .git/objects/ab/cdef used to list every
    // parent folder again on each file operation, which made Git very slow on large folders.
    private final Map<String, String> dirIds = new ConcurrentHashMap<>();

    private static String joinParts(String[] parts, int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) { if (i > 0) sb.append('/'); sb.append(parts[i]); }
        return sb.toString();
    }

    private void dropDirs(String key) {
        for (String k : new ArrayList<>(dirIds.keySet())) {
            if (k.equals(key) || k.startsWith(key + "/")) dirIds.remove(k);
        }
    }

    /** Id of the folder made of parts[0..upTo). Returns null when a part is missing (and create is false). */
    private String dirId(Uri tree, String[] parts, int upTo, boolean create) throws Exception {
        String base = tree.toString() + "|";
        String id = DocumentsContract.getTreeDocumentId(tree);
        int start = 0;
        for (int i = upTo; i > 0; i--) {
            String key = base + joinParts(parts, i);
            String known = dirIds.get(key);
            if (known == null) continue;
            Doc d = null;
            try { d = statDoc(tree, known); } catch (Exception e) { d = null; }
            if (d != null && d.dir) { id = known; start = i; break; }
            dropDirs(key); // the folder changed or was removed outside the app
        }
        for (int i = start; i < upTo; i++) {
            String next = null; boolean isDir = false;
            for (Doc d : children(tree, id)) {
                if (parts[i].equals(d.name)) { next = d.id; isDir = d.dir; break; }
            }
            if (next != null && !isDir) {
                if (create) throw new Exception(parts[i] + " is a file, not a folder");
                return null;
            }
            if (next == null) {
                if (!create) return null;
                Uri created = DocumentsContract.createDocument(resolver(),
                        DocumentsContract.buildDocumentUriUsingTree(tree, id),
                        DocumentsContract.Document.MIME_TYPE_DIR, parts[i]);
                if (created == null) throw new Exception("Could not create folder " + parts[i]);
                next = DocumentsContract.getDocumentId(created);
            }
            id = next;
            dirIds.put(base + joinParts(parts, i + 1), id);
        }
        return id;
    }

    /** Returns the document id for a path, or null when it does not exist. */
    private String findId(Uri tree, String rel) throws Exception {
        String[] parts = splitPath(rel);
        if (parts.length == 0) return DocumentsContract.getTreeDocumentId(tree);
        String parent = dirId(tree, parts, parts.length - 1, false);
        if (parent == null) return null;
        String name = parts[parts.length - 1];
        for (Doc d : children(tree, parent)) {
            if (name.equals(d.name)) return d.id;
        }
        return null;
    }

    private Doc statDoc(Uri tree, String id) {
        Cursor c = null;
        try {
            c = resolver().query(DocumentsContract.buildDocumentUriUsingTree(tree, id), new String[]{
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null);
            if (c != null && c.moveToFirst()) {
                Doc d = new Doc();
                d.id = id;
                d.name = c.getString(0);
                d.mime = c.getString(1);
                d.size = c.isNull(2) ? 0 : c.getLong(2);
                d.modified = c.isNull(3) ? 0 : c.getLong(3);
                d.dir = DocumentsContract.Document.MIME_TYPE_DIR.equals(d.mime);
                return d;
            }
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    private JSObject entry(Doc d, String path) throws JSONException {
        JSObject o = new JSObject();
        o.put("name", d.name);
        o.put("path", path);
        o.put("isDir", d.dir);
        o.put("size", d.size);
        o.put("modified", d.modified);
        return o;
    }



    // ------------------------------------------------------------------ Keep working in the background
    private volatile boolean workActive = false;
    private volatile boolean inForeground = true;

    @PluginMethod
    public void workStart(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 33 && getActivity() != null
                    && getContext().checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                getActivity().requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 4102);
            }
            Intent i = new Intent(getContext(), KdexWorkService.class);
            i.putExtra("text", call.getString("text", "Working on your request"));
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i); else getContext().startService(i);
            workActive = true;
            call.resolve();
        } catch (Throwable t) {
            workActive = false;
            call.resolve(); // optional: the agent still runs while the app is open
        }
    }

    @PluginMethod
    public void workStop(PluginCall call) {
        workActive = false;
        try { getContext().stopService(new Intent(getContext(), KdexWorkService.class)); } catch (Throwable t) { /* ignore */ }
        call.resolve();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        inForeground = true;
        try { ((android.app.NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).cancel(4103); } catch (Throwable t) { /* ignore */ }
    }

    /** Short haptic tap, and when the app is in the background a notification saying the work finished. Everything here is best effort. */
    @PluginMethod
    public void workDone(PluginCall call) {
        try {
            boolean ok = !Boolean.FALSE.equals(call.getBoolean("ok", true));
            try {
                android.os.Vibrator v = (android.os.Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null) {
                    long[] pattern = ok ? new long[]{0, 35} : new long[]{0, 60, 70, 60};
                    if (Build.VERSION.SDK_INT >= 26) v.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1)); else v.vibrate(pattern, -1);
                }
            } catch (Throwable t) { /* no vibrator or no permission */ }
            if (!inForeground) {
                android.app.NotificationManager nm = (android.app.NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    if (Build.VERSION.SDK_INT >= 26) {
                        android.app.NotificationChannel ch = new android.app.NotificationChannel("kdex_done", "Work finished", android.app.NotificationManager.IMPORTANCE_DEFAULT);
                        ch.setDescription("Tells you when KDex Agent has finished");
                        nm.createNotificationChannel(ch);
                    }
                    Intent open = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
                    PendingIntent pi = open == null ? null : PendingIntent.getActivity(getContext(), 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                    android.app.Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new android.app.Notification.Builder(getContext(), "kdex_done") : new android.app.Notification.Builder(getContext());
                    b.setContentTitle(ok ? "KDex Agent finished" : "KDex Agent needs you")
                            .setContentText(call.getString("text", ok ? "Your request is done." : "Something went wrong. Open the app to see."))
                            .setSmallIcon(ok ? android.R.drawable.stat_notify_chat : android.R.drawable.stat_sys_warning).setAutoCancel(true);
                    if (pi != null) b.setContentIntent(pi);
                    nm.notify(4103, b.build());
                }
            }
        } catch (Throwable t) { /* optional */ }
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        inForeground = false;
        if (workActive && getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                try { getBridge().getWebView().resumeTimers(); } catch (Throwable t) { /* ignore */ }
            });
        }
    }

    // ------------------------------------------------------------------ Native Git (JGit), reached by reflection so the app builds and runs without it
    private Object toJson(Object o) throws JSONException {
        if (o instanceof Map) {
            JSObject out = new JSObject();
            for (Object e : ((Map<?, ?>) o).entrySet()) {
                Map.Entry<?, ?> en = (Map.Entry<?, ?>) e;
                out.put(String.valueOf(en.getKey()), toJson(en.getValue()));
            }
            return out;
        }
        if (o instanceof List) {
            JSArray arr = new JSArray();
            for (Object x : (List<?>) o) arr.put(toJson(x));
            return arr;
        }
        return o;
    }

    @PluginMethod
    public void gitNative(PluginCall call) {
        pool.execute(() -> {
            try {
                String op = call.getString("op", "");
                String id = call.getString("id", "");
                Uri tree = Uri.parse(call.getString("uri", ""));
                File root = directRoot(tree);
                if (root == null) { call.reject("native-git-unavailable: direct file access is off"); return; }
                Map<String, String> args = new java.util.HashMap<>();
                JSObject a = call.getObject("args");
                if (a != null) {
                    Iterator<String> keys = a.keys();
                    while (keys.hasNext()) { String k = keys.next(); args.put(k, a.isNull(k) ? "" : String.valueOf(a.get(k))); }
                }
                String rel = call.getString("path", "");
                args.put("dir", fileFor(root, rel).getAbsolutePath());
                System.setProperty("user.home", new File(getContext().getFilesDir(), "jgit-home").getAbsolutePath());
                Class<?> k = Class.forName("com.kdex.agent.KdexGit");
                java.lang.reflect.Method m = k.getMethod("run", String.class, Map.class, String.class, java.util.function.Consumer.class);
                java.util.function.Consumer<Object[]> sink = x -> {
                    try {
                        JSObject ev = new JSObject();
                        ev.put("id", String.valueOf(x[0])); ev.put("phase", String.valueOf(x[1]));
                        ev.put("done", ((Number) x[2]).intValue()); ev.put("total", ((Number) x[3]).intValue());
                        notifyListeners("gitProgress", ev);
                    } catch (Exception e) { /* progress is optional */ }
                };
                Object r = m.invoke(null, op, args, id, sink);
                Object j = toJson(r);
                call.resolve(j instanceof JSObject ? (JSObject) j : new JSObject());
            } catch (ClassNotFoundException | LinkageError e) {
                call.reject("native-git-unavailable: " + e);
            } catch (java.lang.reflect.InvocationTargetException e) {
                Throwable c = e.getCause() != null ? e.getCause() : e;
                if (c instanceof LinkageError) call.reject("native-git-unavailable: " + c);
                else call.reject(c.getClass().getSimpleName() + ": " + String.valueOf(c.getMessage()));
            } catch (Throwable e) {
                call.reject(e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void gitCancel(PluginCall call) {
        try {
            Class<?> k = Class.forName("com.kdex.agent.KdexGit");
            k.getMethod("cancel", String.class).invoke(null, call.getString("id", ""));
        } catch (Throwable t) { /* nothing to cancel */ }
        call.resolve();
    }

    // ------------------------------------------------------------------ Direct file access
    // With "All files access" the app reads and writes shared storage through normal file paths. That is how Termux
    // works and it is far faster than Android's folder access (SAF), which needs a content query for every step.
    // Without the permission, or for folders outside shared storage, the SAF code below is used unchanged.

    private boolean allFilesGranted() {
        try { return Build.VERSION.SDK_INT >= 30 && android.os.Environment.isExternalStorageManager(); } catch (Throwable t) { return false; }
    }

    @PluginMethod
    public void allFilesStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", Build.VERSION.SDK_INT >= 30);
        ret.put("granted", allFilesGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestAllFiles(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            try {
                Intent j = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                j.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(j);
            } catch (Exception e2) { call.reject("Could not open the settings screen"); return; }
        }
        call.resolve();
    }

    /** The real folder behind a picked tree, or null when direct access is not possible (then SAF is used). */
    private File directRoot(Uri tree) {
        try {
            if (!allFilesGranted()) return null;
            if (!"com.android.externalstorage.documents".equals(tree.getAuthority())) return null;
            String id = DocumentsContract.getTreeDocumentId(tree);
            int c = id.indexOf(':');
            if (c < 0) return null;
            String vol = id.substring(0, c);
            String rest = id.substring(c + 1);
            File base = "primary".equals(vol) ? android.os.Environment.getExternalStorageDirectory() : new File("/storage/" + vol);
            File f = rest.isEmpty() ? base : new File(base, rest);
            return f.isDirectory() ? f : null;
        } catch (Exception e) { return null; }
    }

    private File fileFor(File root, String rel) throws Exception {
        File f = root;
        for (String p : splitPath(rel)) f = new File(f, p);
        return f;
    }

    private static String baseOfRel(String rel) {
        return rel == null || rel.isEmpty() ? "" : rel.replaceAll("/+$", "") + "/";
    }

    private JSObject fileEntry(File f, String path) throws JSONException {
        JSObject o = new JSObject();
        boolean dir = f.isDirectory();
        o.put("name", f.getName());
        o.put("path", path);
        o.put("isDir", dir);
        o.put("size", dir ? 0 : f.length());
        o.put("modified", f.lastModified());
        return o;
    }

    private void dList(PluginCall call, File root, String rel) throws Exception {
        File dir = fileFor(root, rel);
        if (!dir.exists()) { call.reject("Not found: " + rel); return; }
        File[] kids = dir.listFiles();
        if (kids == null) { call.reject("Cannot open " + rel); return; }
        JSArray arr = new JSArray();
        String base = baseOfRel(rel);
        for (File k : kids) arr.put(fileEntry(k, base + k.getName()));
        JSObject ret = new JSObject();
        ret.put("entries", arr);
        call.resolve(ret);
    }

    private void dWalkInto(File dir, String base, JSArray out, int max, int[] count) throws Exception {
        File[] kids = dir.listFiles();
        if (kids == null) return;
        for (File k : kids) {
            if (count[0] >= max) return;
            String path = base + k.getName();
            if (k.isDirectory()) {
                if (SKIP_DIRS.contains(k.getName())) continue;
                if (!k.getCanonicalPath().equals(k.getAbsolutePath())) continue; // symlinked folder: skip, avoids loops
                dWalkInto(k, path + "/", out, max, count);
            } else {
                out.put(fileEntry(k, path));
                count[0]++;
            }
        }
    }

    private void dWalk(PluginCall call, File root, String rel, int max) throws Exception {
        File dir = fileFor(root, rel);
        if (!dir.exists()) { call.reject("Not found: " + rel); return; }
        JSArray arr = new JSArray();
        int[] count = new int[]{0};
        dWalkInto(dir, baseOfRel(rel), arr, max, count);
        JSObject ret = new JSObject();
        ret.put("files", arr);
        ret.put("truncated", count[0] >= max);
        call.resolve(ret);
    }

    private void dStat(PluginCall call, File root, String rel) throws Exception {
        File f = fileFor(root, rel);
        JSObject ret = new JSObject();
        boolean ex = f.exists();
        ret.put("exists", ex);
        if (ex) { ret.put("isDir", f.isDirectory()); ret.put("size", f.isDirectory() ? 0 : f.length()); ret.put("modified", f.lastModified()); }
        call.resolve(ret);
    }

    private void dReadText(PluginCall call, File root, String rel, int maxBytes) throws Exception {
        File f = fileFor(root, rel);
        if (!f.exists()) { call.reject("Not found: " + rel); return; }
        if (f.isDirectory()) { call.reject("This is a folder, not a file: " + rel); return; }
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        boolean truncated = false;
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) {
                if (bos.size() + n > maxBytes) {
                    bos.write(buf, 0, maxBytes - bos.size());
                    truncated = true;
                    break;
                }
                bos.write(buf, 0, n);
            }
        }
        byte[] bytes = bos.toByteArray();
        boolean binary = false;
        for (int i = 0; i < Math.min(bytes.length, 8000); i++) {
            if (bytes[i] == 0) { binary = true; break; }
        }
        JSObject ret = new JSObject();
        ret.put("size", f.length());
        ret.put("binary", binary);
        ret.put("truncated", truncated);
        ret.put("text", binary ? "" : new String(bytes, StandardCharsets.UTF_8));
        call.resolve(ret);
    }

    private void dReadB64(PluginCall call, File root, String rel) throws Exception {
        File f = fileFor(root, rel);
        if (!f.exists()) { call.reject("ENOENT: " + rel); return; }
        if (f.isDirectory()) { call.reject("EISDIR: " + rel); return; }
        if (f.length() > MAX_BYTES_FILE) { call.reject("File too large: " + rel); return; }
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
        }
        JSObject ret = new JSObject();
        ret.put("b64", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
        call.resolve(ret);
    }

    private void dWrite(PluginCall call, File root, String rel, byte[] data, boolean okFlag) throws Exception {
        if (splitPath(rel).length == 0) { call.reject("A file path is required"); return; }
        File f = fileFor(root, rel);
        if (f.isDirectory()) { call.reject(rel + " is a folder"); return; }
        File parent = f.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs() && !parent.isDirectory()) { call.reject("Could not create folder for " + rel); return; }
        try (OutputStream os = new FileOutputStream(f)) { os.write(data); }
        if (okFlag) { JSObject ret = new JSObject(); ret.put("ok", true); call.resolve(ret); } else call.resolve();
    }

    private static boolean deleteTree(File f) {
        boolean plain;
        try { plain = f.getCanonicalPath().equals(f.getAbsolutePath()); } catch (Exception e) { plain = false; }
        if (f.isDirectory() && plain) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteTree(k);
        }
        return f.delete();
    }

    private void dRemove(PluginCall call, File root, String rel) throws Exception {
        if (splitPath(rel).length == 0) { call.reject("Refusing to delete the chosen folder itself"); return; }
        File f = fileFor(root, rel);
        if (!f.exists()) { call.reject("Not found: " + rel); return; }
        boolean ok = deleteTree(f);
        if (!ok) { call.reject("Could not delete " + rel); return; }
        call.resolve();
    }

    private void dMkdir(PluginCall call, File root, String rel) throws Exception {
        File f = fileFor(root, rel);
        if (!f.isDirectory() && !f.mkdirs() && !f.isDirectory()) { call.reject("Could not create folder " + rel); return; }
        call.resolve();
    }

    @PluginMethod
    public void list(PluginCall call) {
        pool.execute(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri", ""));
                String rel = call.getString("path", "");
                File dr = directRoot(tree);
                if (dr != null) { dList(call, dr, rel); return; }
                String id = findId(tree, rel);
                if (id == null) { call.reject("Not found: " + rel); return; }
                List<Doc> kids = children(tree, id);
                JSArray arr = new JSArray();
                String base = rel == null || rel.isEmpty() ? "" : rel.replaceAll("/+$", "") + "/";
                for (Doc d : kids) arr.put(entry(d, base + d.name));
                JSObject ret = new JSObject();
                ret.put("entries", arr);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    private void walkInto(Uri tree, String id, String base, JSArray out, int max, int[] count) throws Exception {
        for (Doc d : children(tree, id)) {
            if (count[0] >= max) return;
            String path = base + d.name;
            if (d.dir) {
                if (SKIP_DIRS.contains(d.name)) continue;
                walkInto(tree, d.id, path + "/", out, max, count);
            } else {
                out.put(entry(d, path));
                count[0]++;
            }
        }
    }

    @PluginMethod
    public void walk(PluginCall call) {
        pool.execute(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri", ""));
                String rel = call.getString("path", "");
                File dr = directRoot(tree);
                if (dr != null) { dWalk(call, dr, rel, call.getInt("max", 3000)); return; }
                int max = call.getInt("max", 3000);
                String id = findId(tree, rel);
                if (id == null) { call.reject("Not found: " + rel); return; }
                JSArray arr = new JSArray();
                int[] count = new int[]{0};
                String base = rel == null || rel.isEmpty() ? "" : rel.replaceAll("/+$", "") + "/";
                walkInto(tree, id, base, arr, max, count);
                JSObject ret = new JSObject();
                ret.put("files", arr);
                ret.put("truncated", count[0] >= max);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void stat(PluginCall call) {
        pool.execute(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri", ""));
                String rel = call.getString("path", "");
                File dr = directRoot(tree);
                if (dr != null) { dStat(call, dr, rel); return; }
                String id = findId(tree, rel);
                JSObject ret = new JSObject();
                if (id == null) { ret.put("exists", false); call.resolve(ret); return; }
                Doc d = statDoc(tree, id);
                ret.put("exists", d != null);
                if (d != null) { ret.put("isDir", d.dir); ret.put("size", d.size); ret.put("modified", d.modified); }
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void readText(PluginCall call) {
        pool.execute(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri", ""));
                String rel = call.getString("path", "");
                File dr = directRoot(tree);
                if (dr != null) { dReadText(call, dr, rel, Math.min(call.getInt("maxBytes", MAX_READ_BYTES), MAX_READ_BYTES)); return; }
                int maxBytes = Math.min(call.getInt("maxBytes", MAX_READ_BYTES), MAX_READ_BYTES);
                String id = findId(tree, rel);
                if (id == null) { call.reject("Not found: " + rel); return; }
                Doc d = statDoc(tree, id);
                if (d != null && d.dir) { call.reject("This is a folder, not a file: " + rel); return; }
                Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                boolean truncated = false;
                try (InputStream in = resolver().openInputStream(doc)) {
                    if (in == null) { call.reject("Cannot open " + rel); return; }
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        if (bos.size() + n > maxBytes) {
                            bos.write(buf, 0, maxBytes - bos.size());
                            truncated = true;
                            break;
                        }
                        bos.write(buf, 0, n);
                    }
                }
                byte[] bytes = bos.toByteArray();
                boolean binary = false;
                for (int i = 0; i < Math.min(bytes.length, 8000); i++) {
                    if (bytes[i] == 0) { binary = true; break; }
                }
                JSObject ret = new JSObject();
                ret.put("size", d != null ? d.size : bytes.length);
                ret.put("binary", binary);
                ret.put("truncated", truncated);
                ret.put("text", binary ? "" : new String(bytes, StandardCharsets.UTF_8));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    private String ensureDir(Uri tree, String[] parts, int upTo) throws Exception {
        return dirId(tree, parts, upTo, true);
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        pool.execute(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri", ""));
                String rel = call.getString("path", "");
                File dr = directRoot(tree);
                if (dr != null) { dWrite(call, dr, rel, call.getString("text", "").getBytes(StandardCharsets.UTF_8), true); return; }
                String text = call.getString("text", "");
                String[] parts = splitPath(rel);
                if (parts.length == 0) { call.reject("A file path is required"); return; }
                String parentId = ensureDir(tree, parts, parts.length - 1);
                String name = parts[parts.length - 1];
                String fileId = null;
                for (Doc d : children(tree, parentId)) {
                    if (name.equals(d.name)) {
                        if (d.dir) { call.reject(rel + " is a folder"); return; }
                        fileId = d.id;
                        break;
                    }
                }
                Uri target;
                if (fileId == null) {
                    // octet-stream keeps the provider from adding its own extension
                    target = DocumentsContract.createDocument(resolver(),
                            DocumentsContract.buildDocumentUriUsingTree(tree, parentId), "application/octet-stream", name);
                    if (target == null) { call.reject("Could not create " + rel); return; }
                } else {
                    target = DocumentsContract.buildDocumentUriUsingTree(tree, fileId);
                }
                try (OutputStream os = resolver().openOutputStream(target, "wt")) {
                    if (os == null) { call.reject("Cannot write " + rel); return; }
                    os.write(text.getBytes(StandardCharsets.UTF_8));
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        pool.execute(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri", ""));
                String rel = call.getString("path", "");
                File dr = directRoot(tree);
                if (dr != null) { dRemove(call, dr, rel); return; }
                if (splitPath(rel).length == 0) { call.reject("Refusing to delete the chosen folder itself"); return; }
                String id = findId(tree, rel);
                if (id == null) { call.reject("Not found: " + rel); return; }
                boolean ok = DocumentsContract.deleteDocument(resolver(), DocumentsContract.buildDocumentUriUsingTree(tree, id));
                dropDirs(tree.toString() + "|" + joinParts(splitPath(rel), splitPath(rel).length));
                if (!ok) { call.reject("Could not delete " + rel); return; }
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void readB64(PluginCall call) {
        pool.execute(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri", ""));
                String rel = call.getString("path", "");
                File dr = directRoot(tree);
                if (dr != null) { dReadB64(call, dr, rel); return; }
                String id = findId(tree, rel);
                if (id == null) { call.reject("ENOENT: " + rel); return; }
                Doc d = statDoc(tree, id);
                if (d != null && d.dir) { call.reject("EISDIR: " + rel); return; }
                if (d != null && d.size > MAX_BYTES_FILE) { call.reject("File too large: " + rel); return; }
                Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                try (InputStream in = resolver().openInputStream(doc)) {
                    if (in == null) { call.reject("Cannot open " + rel); return; }
                    byte[] buf = new byte[32768];
                    int n;
                    while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
                }
                JSObject ret = new JSObject();
                ret.put("b64", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void writeB64(PluginCall call) {
        pool.execute(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri", ""));
                String rel = call.getString("path", "");
                File dr = directRoot(tree);
                if (dr != null) { dWrite(call, dr, rel, Base64.decode(call.getString("b64", ""), Base64.DEFAULT), false); return; }
                byte[] data = Base64.decode(call.getString("b64", ""), Base64.DEFAULT);
                String[] parts = splitPath(rel);
                if (parts.length == 0) { call.reject("A file path is required"); return; }
                String parentId = ensureDir(tree, parts, parts.length - 1);
                String name = parts[parts.length - 1];
                String fileId = null;
                for (Doc d : children(tree, parentId)) {
                    if (name.equals(d.name)) {
                        if (d.dir) { call.reject(rel + " is a folder"); return; }
                        fileId = d.id;
                        break;
                    }
                }
                Uri target = fileId == null
                        ? DocumentsContract.createDocument(resolver(), DocumentsContract.buildDocumentUriUsingTree(tree, parentId), "application/octet-stream", name)
                        : DocumentsContract.buildDocumentUriUsingTree(tree, fileId);
                if (target == null) { call.reject("Could not create " + rel); return; }
                try (OutputStream os = resolver().openOutputStream(target, "wt")) {
                    if (os == null) { call.reject("Cannot write " + rel); return; }
                    os.write(data);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        pool.execute(() -> {
            try {
                Uri tree = Uri.parse(call.getString("uri", ""));
                File dr = directRoot(tree);
                if (dr != null) { dMkdir(call, dr, call.getString("path", "")); return; }
                String[] parts = splitPath(call.getString("path", ""));
                ensureDir(tree, parts, parts.length);
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }
}
