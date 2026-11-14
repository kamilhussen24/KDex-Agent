package com.kamildex.agent;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.SftpATTRS;
import com.jcraft.jsch.SftpException;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Vector;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Remote servers over SSH: files (SFTP) and commands. Built on JSch, with no Android dependencies, so it is compiled and tested on a normal JVM.
 * KdexNativePlugin calls {@link #run} by reflection; if this class or JSch is missing the app simply has no server support.
 * Arguments come in as strings; results are Maps, Lists, Strings, Numbers and Booleans only.
 * Every path is relative to "root" and can never leave it.
 */
public class KdexRemote {
    private static final Map<String, Conn> CONNS = new ConcurrentHashMap<>();
    private static final Map<String, ChannelExec> RUNNING = new ConcurrentHashMap<>();
    private static final int CONNECT_MS = 15000;
    private static final int SKIP_WALK_MAX = 4000;

    private static class Conn {
        final Session session; final ChannelSftp sftp; final String fingerprint;
        Conn(Session s, ChannelSftp f, String fp) { session = s; sftp = f; fingerprint = fp; }
        boolean alive() { return session.isConnected() && sftp.isConnected() && !sftp.isClosed(); }
        void close() { try { sftp.disconnect(); } catch (Throwable t) { /* ignore */ } try { session.disconnect(); } catch (Throwable t) { /* ignore */ } }
    }

    /** One operation. Rejects with a short, plain message the app can show as it is. */
    public static Object run(String op, Map<String, String> a) throws Exception {
        switch (op) {
            case "test": return test(a);
            case "close": close(a.get("id")); return new HashMap<String, Object>();
            case "cancel": cancel(a.get("runId")); return new HashMap<String, Object>();
            case "exec": return exec(a);
            default: break;
        }
        try { return files(op, a, conn(a)); }
        catch (SftpException | com.jcraft.jsch.JSchException e) {
            if (isDead(e)) { close(a.get("id")); return files(op, a, conn(a)); } // the link dropped while idle: connect again, once
            throw nice(e, a);
        }
    }

    // ------------------------------------------------------------------ connection

    private static boolean isDead(Exception e) {
        String m = String.valueOf(e.getMessage()).toLowerCase();
        return m.contains("session is down") || m.contains("channel is not opened") || m.contains("socket") || m.contains("connection reset") || m.contains("broken pipe") || m.contains("eof") || m.contains("channel is broken");
    }

    private static Exception nice(Exception e, Map<String, String> a) {
        String m = String.valueOf(e.getMessage());
        if (e instanceof SftpException) {
            int id = ((SftpException) e).id;
            if (id == ChannelSftp.SSH_FX_NO_SUCH_FILE) return new Exception("Not found: " + a.getOrDefault("path", ""));
            if (id == ChannelSftp.SSH_FX_PERMISSION_DENIED) return new Exception("Permission denied: " + a.getOrDefault("path", "") + ". The server user is not allowed to do this.");
            return new Exception(m);
        }
        return explain(e);
    }

    /** Turns JSch's terse errors into sentences a person can act on. */
    static Exception explain(Throwable e) {
        String m = String.valueOf(e.getMessage());
        String l = m.toLowerCase();
        if (l.contains("auth fail") || l.contains("auth cancel")) return new Exception("The server refused the sign-in. Check the user name and the password or key.");
        if (l.contains("unknownhost") || l.contains("unknown host") || l.contains("nodename nor servname") || l.contains("unresolved")) return new Exception("Could not find that host. Check the address.");
        if (l.contains("timeout") || l.contains("timed out")) return new Exception("The server did not answer in time. Check the address, the port and your connection.");
        if (l.contains("refused")) return new Exception("The server refused the connection. Check the port, and that SSH is running.");
        if (l.contains("invalid privatekey") || l.contains("invalid private key") || l.contains("privatekey")) return new Exception("This key cannot be read. Use an RSA or ECDSA key in PEM or OpenSSH format, or sign in with a password. Ed25519 keys are not supported yet.");
        if (l.contains("changed")) return new Exception(m);
        return new Exception(m.isEmpty() || m.equals("null") ? e.getClass().getSimpleName() : m);
    }

    private static String cacheKey(Map<String, String> a) { return a.getOrDefault("id", "") + "|" + a.get("host") + "|" + a.get("port") + "|" + a.get("user"); }

    private static Conn conn(Map<String, String> a) throws Exception {
        String k = cacheKey(a);
        Conn c = CONNS.get(k);
        if (c != null && c.alive()) return c;
        if (c != null) { c.close(); CONNS.remove(k); }
        c = open(a);
        CONNS.put(k, c);
        return c;
    }

    private static Conn open(Map<String, String> a) throws Exception {
        String host = need(a, "host"); String user = need(a, "user");
        int port = 22; try { port = Integer.parseInt(a.getOrDefault("port", "22")); } catch (Exception e) { /* default */ }
        JSch jsch = new JSch();
        String key = a.get("key"); String pass = a.get("passphrase");
        try {
            if (key != null && !key.trim().isEmpty()) jsch.addIdentity("kdex", (key.trim() + "\n").getBytes(StandardCharsets.UTF_8), null, pass == null || pass.isEmpty() ? null : pass.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) { throw explain(e); }
        Session s = jsch.getSession(user, host, port);
        String password = a.get("password");
        if (password != null && !password.isEmpty()) s.setPassword(password);
        Properties cfg = new Properties();
        cfg.put("StrictHostKeyChecking", "no"); // the key is compared below with the one saved on the first connection
        cfg.put("PreferredAuthentications", key != null && !key.trim().isEmpty() ? "publickey,password,keyboard-interactive" : "password,keyboard-interactive,publickey");
        s.setConfig(cfg);
        s.setServerAliveInterval(15000);
        s.setServerAliveCountMax(3);
        try { s.connect(CONNECT_MS); } catch (Exception e) { throw explain(e); }
        String fp = s.getHostKey().getFingerPrint(jsch);
        String want = a.get("fingerprint");
        if (want != null && !want.isEmpty() && !want.equals(fp)) {
            try { s.disconnect(); } catch (Throwable t) { /* ignore */ }
            throw new Exception("The server's key changed since you first connected. This can mean the server was rebuilt, or someone is in the middle. Remove the saved server and add it again only if you trust the change.");
        }
        ChannelSftp f;
        try { f = (ChannelSftp) s.openChannel("sftp"); f.connect(CONNECT_MS); }
        catch (Exception e) { try { s.disconnect(); } catch (Throwable t) { /* ignore */ } throw new Exception("Signed in, but the server has no file access (SFTP). Ask the host to enable it."); }
        return new Conn(s, f, fp);
    }

    private static void close(String id) {
        for (String k : new ArrayList<>(CONNS.keySet())) {
            if (id == null || id.isEmpty() || k.startsWith(id + "|")) { Conn c = CONNS.remove(k); if (c != null) c.close(); }
        }
    }

    private static Map<String, Object> test(Map<String, String> a) throws Exception {
        Conn c = open(a);
        try {
            Map<String, Object> r = new HashMap<>();
            r.put("fingerprint", c.fingerprint);
            String home = ""; try { home = c.sftp.getHome(); } catch (Exception e) { /* optional */ }
            r.put("home", home);
            String root = a.getOrDefault("root", "");
            if (root.isEmpty()) root = home;
            r.put("root", root);
            try { SftpATTRS at = c.sftp.stat(root); r.put("rootFound", true); r.put("rootIsDir", at.isDir()); }
            catch (SftpException e) { r.put("rootFound", false); r.put("rootIsDir", false); }
            return r;
        } finally { c.close(); }
    }

    private static String need(Map<String, String> a, String k) throws Exception {
        String v = a.get(k);
        if (v == null || v.trim().isEmpty()) throw new Exception("Missing " + k + ".");
        return v.trim();
    }

    // ------------------------------------------------------------------ paths: never leave the root

    static String norm(String p) {
        List<String> out = new ArrayList<>();
        for (String s : p.replace('\\', '/').split("/")) {
            if (s.isEmpty() || s.equals(".")) continue;
            if (s.equals("..")) { if (!out.isEmpty()) out.remove(out.size() - 1); continue; }
            out.add(s);
        }
        return "/" + String.join("/", out);
    }

    /** The full server path for a path inside the root. Rejects anything that climbs out of it. */
    static String inRoot(Map<String, String> a, String rel) throws Exception {
        String root = norm(a.getOrDefault("root", "/"));
        String r = rel == null ? "" : rel.replace('\\', '/');
        int depth = 0;
        for (String s : r.split("/")) { if (s.equals("..")) depth--; else if (!s.isEmpty() && !s.equals(".")) depth++; if (depth < 0) throw new Exception("That path is outside the server folder: " + rel); }
        String full = norm(root + "/" + r);
        if (!(full.equals(root) || full.startsWith(root.equals("/") ? "/" : root + "/"))) throw new Exception("That path is outside the server folder: " + rel);
        return full;
    }

    static String relOf(Map<String, String> a, String full) {
        String root = norm(a.getOrDefault("root", "/"));
        String r = full.equals(root) ? "" : full.substring(root.equals("/") ? 1 : root.length() + 1);
        return r;
    }

    // ------------------------------------------------------------------ files

    private static Object files(String op, Map<String, String> a, Conn c) throws Exception {
        ChannelSftp f = c.sftp;
        String path = a.getOrDefault("path", "");
        switch (op) {
            case "list": return list(a, f, inRoot(a, path));
            case "stat": return stat(f, inRoot(a, path));
            case "walk": return walk(a, f, inRoot(a, path), Math.max(1, Math.min(SKIP_WALK_MAX, intOf(a.get("max"), 3000))));
            case "read": return read(f, inRoot(a, path), longOf(a.get("offset"), 0), intOf(a.get("length"), 1048576));
            case "write": write(f, inRoot(a, path), a.getOrDefault("b64", ""), "1".equals(a.get("append"))); return new HashMap<String, Object>();
            case "mkdir": mkdirs(f, inRoot(a, path)); return new HashMap<String, Object>();
            case "remove": remove(f, inRoot(a, path)); return new HashMap<String, Object>();
            case "rename": {
                String to = inRoot(a, a.getOrDefault("to", ""));
                mkdirs(f, parentOf(to));
                f.rename(inRoot(a, path), to);
                return new HashMap<String, Object>();
            }
            default: throw new Exception("Unknown operation: " + op);
        }
    }

    private static int intOf(String s, int d) { try { return Integer.parseInt(s); } catch (Exception e) { return d; } }
    private static long longOf(String s, long d) { try { return Long.parseLong(s); } catch (Exception e) { return d; } }
    private static String parentOf(String full) { int i = full.lastIndexOf('/'); return i <= 0 ? "/" : full.substring(0, i); }

    private static Map<String, Object> entry(Map<String, String> a, String full, String name, SftpATTRS at, ChannelSftp f) {
        boolean dir = at.isDir();
        long size = at.getSize();
        if (at.isLink()) { try { SftpATTRS t = f.stat(full); dir = t.isDir(); size = t.getSize(); } catch (Exception e) { /* broken link: a file */ } }
        Map<String, Object> m = new HashMap<>();
        m.put("name", name); m.put("path", relOf(a, full)); m.put("isDir", dir); m.put("size", dir ? 0 : size); m.put("modified", (long) at.getMTime() * 1000L);
        return m;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> list(Map<String, String> a, ChannelSftp f, String full) throws Exception {
        Vector<ChannelSftp.LsEntry> v = f.ls(full);
        List<Object> out = new ArrayList<>();
        for (ChannelSftp.LsEntry e : v) {
            String n = e.getFilename();
            if (n.equals(".") || n.equals("..")) continue;
            out.add(entry(a, full.equals("/") ? "/" + n : full + "/" + n, n, e.getAttrs(), f));
        }
        Map<String, Object> r = new HashMap<>(); r.put("entries", out); return r;
    }

    private static Map<String, Object> stat(ChannelSftp f, String full) throws Exception {
        Map<String, Object> m = new HashMap<>();
        try {
            SftpATTRS at = f.stat(full);
            m.put("exists", true); m.put("isDir", at.isDir()); m.put("size", at.isDir() ? 0 : at.getSize()); m.put("modified", (long) at.getMTime() * 1000L);
        } catch (SftpException e) {
            if (e.id != ChannelSftp.SSH_FX_NO_SUCH_FILE) throw e;
            m.put("exists", false); m.put("isDir", false); m.put("size", 0); m.put("modified", 0);
        }
        return m;
    }

    private static final java.util.Set<String> SKIP_DIRS = new java.util.HashSet<>(java.util.Arrays.asList("node_modules", ".git", ".cache", "vendor", "__pycache__", ".venv", "venv"));

    @SuppressWarnings("unchecked")
    private static Map<String, Object> walk(Map<String, String> a, ChannelSftp f, String full, int max) throws Exception {
        List<Object> files = new ArrayList<>();
        java.util.ArrayDeque<String> queue = new java.util.ArrayDeque<>();
        queue.add(full);
        boolean truncated = false;
        while (!queue.isEmpty() && !truncated) {
            String dir = queue.poll();
            Vector<ChannelSftp.LsEntry> v;
            try { v = f.ls(dir); } catch (SftpException e) { continue; }
            for (ChannelSftp.LsEntry e : v) {
                String n = e.getFilename();
                if (n.equals(".") || n.equals("..")) continue;
                SftpATTRS at = e.getAttrs();
                String child = dir.equals("/") ? "/" + n : dir + "/" + n;
                if (at.isLink()) continue; // never follow links: no loops, nothing outside the folder
                if (at.isDir()) { if (!SKIP_DIRS.contains(n)) queue.add(child); continue; }
                if (files.size() >= max) { truncated = true; break; }
                files.add(entry(a, child, n, at, f));
            }
        }
        Map<String, Object> r = new HashMap<>(); r.put("files", files); r.put("truncated", truncated); return r;
    }

    /** Reads up to "length" bytes from "offset". "eof" is true when the end of the file was reached. */
    private static Map<String, Object> read(ChannelSftp f, String full, long offset, int length) throws Exception {
        SftpATTRS at = f.stat(full);
        if (at.isDir()) throw new Exception("This is a folder, not a file.");
        long size = at.getSize();
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(16, Math.min(length, (int) Math.max(0, size - offset))));
        if (offset < size && length > 0) {
            try (InputStream in = f.get(full, null, offset)) {
                byte[] buf = new byte[32768]; int left = length;
                while (left > 0) { int n = in.read(buf, 0, Math.min(buf.length, left)); if (n < 0) break; out.write(buf, 0, n); left -= n; }
            }
        }
        Map<String, Object> r = new HashMap<>();
        r.put("b64", Base64.getEncoder().encodeToString(out.toByteArray()));
        r.put("size", size);
        r.put("eof", offset + out.size() >= size);
        return r;
    }

    private static void write(ChannelSftp f, String full, String b64, boolean append) throws Exception {
        mkdirs(f, parentOf(full));
        byte[] data = Base64.getDecoder().decode(b64);
        try (OutputStream o = f.put(full, append ? ChannelSftp.APPEND : ChannelSftp.OVERWRITE)) { o.write(data); }
    }

    private static void mkdirs(ChannelSftp f, String full) throws Exception {
        if (full.equals("/") || full.isEmpty()) return;
        try { SftpATTRS at = f.stat(full); if (at.isDir()) return; throw new Exception("A file with this name is in the way: " + full); }
        catch (SftpException e) { if (e.id != ChannelSftp.SSH_FX_NO_SUCH_FILE) throw e; }
        mkdirs(f, parentOf(full));
        f.mkdir(full);
    }

    @SuppressWarnings("unchecked")
    private static void remove(ChannelSftp f, String full) throws Exception {
        SftpATTRS at = f.lstat(full);
        if (at.isDir() && !at.isLink()) {
            Vector<ChannelSftp.LsEntry> v = f.ls(full);
            for (ChannelSftp.LsEntry e : v) {
                String n = e.getFilename();
                if (n.equals(".") || n.equals("..")) continue;
                remove(f, full + "/" + n);
            }
            f.rmdir(full);
        } else f.rm(full);
    }

    // ------------------------------------------------------------------ commands

    /** Runs one command in "cwd" with the user's login shell settings. Returns { stdout, stderr, exitCode, errmsg }. */
    private static Map<String, Object> exec(Map<String, String> a) throws Exception {
        Conn c = conn(a);
        String cwd = inRoot(a, a.getOrDefault("cwd", ""));
        String command = need(a, "command");
        int secs = Math.max(5, Math.min(600, intOf(a.get("timeout"), 120)));
        String mark = "__KDEX_" + Long.toHexString(System.nanoTime()) + "__";
        // the login profile of some servers prints a banner first; the marker lets us cut everything before the real output
        String script = "echo " + mark + "; cd " + sq(cwd) + " && " + command;
        // bash -l reads the user's profile (so pm2, node and nvm are found); servers without bash fall back to sh
        String wrapped = "S=\"$(echo " + Base64.getEncoder().encodeToString(script.getBytes(StandardCharsets.UTF_8)) + " | base64 -d)\"; if command -v bash >/dev/null 2>&1; then exec bash -lc \"$S\"; else exec sh -c \"$S\"; fi";
        ChannelExec ch;
        try { ch = (ChannelExec) c.session.openChannel("exec"); }
        catch (Exception e) { close(a.get("id")); c = conn(a); ch = (ChannelExec) c.session.openChannel("exec"); }
        ch.setCommand(wrapped);
        ByteArrayOutputStream so = new ByteArrayOutputStream(), se = new ByteArrayOutputStream();
        ch.setOutputStream(so); ch.setErrStream(se);
        String runId = a.getOrDefault("runId", "");
        if (!runId.isEmpty()) RUNNING.put(runId, ch);
        String errmsg = "";
        try {
            ch.connect(CONNECT_MS);
            long end = System.currentTimeMillis() + secs * 1000L;
            while (!ch.isClosed() && System.currentTimeMillis() < end) Thread.sleep(80);
            if (!ch.isClosed()) { errmsg = "Stopped after " + secs + " seconds. The command was still running."; ch.disconnect(); }
        } finally { if (!runId.isEmpty()) RUNNING.remove(runId); ch.disconnect(); }
        Map<String, Object> r = new HashMap<>();
        String outText = new String(so.toByteArray(), StandardCharsets.UTF_8);
        int mi = outText.indexOf(mark);
        if (mi >= 0) { int e = mi + mark.length(); if (e < outText.length() && outText.charAt(e) == '\r') e++; if (e < outText.length() && outText.charAt(e) == '\n') e++; outText = outText.substring(e); }
        r.put("stdout", outText);
        r.put("stderr", new String(se.toByteArray(), StandardCharsets.UTF_8));
        r.put("exitCode", errmsg.isEmpty() ? ch.getExitStatus() : -1);
        r.put("errmsg", errmsg);
        return r;
    }

    private static void cancel(String runId) { ChannelExec ch = runId == null ? null : RUNNING.get(runId); if (ch != null) ch.disconnect(); }

    private static String sq(String s) { return "'" + s.replace("'", "'\\''") + "'"; }
}
