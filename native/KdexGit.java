package com.kdex.agent;

import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.MergeResult;
import org.eclipse.jgit.api.PullResult;
import org.eclipse.jgit.api.Status;
import org.eclipse.jgit.lib.BatchingProgressMonitor;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.lib.StoredConfig;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.transport.PushResult;
import org.eclipse.jgit.transport.RemoteRefUpdate;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * Fast Git for real folders, built on JGit. It has no Android dependencies, so it is compiled and tested on a normal JVM.
 * KdexNativePlugin calls {@link #run} by reflection; if this class or JGit is missing the app falls back to its JavaScript Git.
 * Arguments come in as strings; results are Maps, Lists, Strings, Numbers and Booleans only.
 */
public class KdexGit {
    private static final Map<String, Boolean> CANCELLED = new ConcurrentHashMap<>();

    /** Protocol v0 works with every host; JGit's default (v2) is not needed for push, fetch and clone here. */
    private static synchronized void ensureUserConfig() {
        try {
            String home = System.getProperty("user.home");
            if (home == null || home.isEmpty()) return;
            File f = new File(home, ".gitconfig");
            if (!f.exists()) {
                File h = new File(home);
                if (!h.isDirectory() && !h.mkdirs()) return;
                java.nio.file.Files.write(f.toPath(), "[protocol]\n\tversion = 0\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
        } catch (Exception e) { /* optional */ }
    }

    public static void cancel(String id) { if (id != null) CANCELLED.put(id, Boolean.TRUE); }

    /** Reports progress as {id, phase, done, total} and honours cancel(id). */
    private static class Monitor extends BatchingProgressMonitor {
        private final String id; private final Consumer<Object[]> sink;
        Monitor(String id, Consumer<Object[]> sink) { this.id = id; this.sink = sink; setDelayStart(150, java.util.concurrent.TimeUnit.MILLISECONDS); }
        @Override protected void onUpdate(String task, int cur) { emit(task, cur, 0); }
        @Override protected void onEndTask(String task, int cur) { emit(task, cur, 0); }
        @Override protected void onUpdate(String task, int cur, int total, int pct) { emit(task, cur, total); }
        @Override protected void onEndTask(String task, int cur, int total, int pct) { emit(task, cur, total); }
        @Override public boolean isCancelled() { return id != null && CANCELLED.containsKey(id); }
        private void emit(String task, int cur, int total) { if (sink != null) sink.accept(new Object[]{id, task, cur, total}); }
    }

    private static String arg(Map<String, String> a, String k) { String v = a.get(k); return v == null ? "" : v; }

    private static List<String> lines(String s) {
        List<String> out = new ArrayList<>();
        if (s == null) return out;
        for (String l : s.split("\n")) if (!l.isEmpty()) out.add(l);
        return out;
    }

    private static UsernamePasswordCredentialsProvider creds(Map<String, String> a) {
        String token = arg(a, "token");
        if (token.isEmpty()) return null;
        String user = arg(a, "user");
        return new UsernamePasswordCredentialsProvider(user.isEmpty() ? "git" : user, token);
    }

    /** Opens the repository and turns off file-mode tracking once: shared storage reports every file as executable. */
    private static Git open(String dir) throws Exception {
        Git git = Git.open(new File(dir));
        Repository repo = git.getRepository();
        StoredConfig cfg = repo.getConfig();
        if (cfg.getString("core", null, "filemode") == null) {
            cfg.setBoolean("core", null, "filemode", false);
            cfg.save();
        }
        return git;
    }

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    public static Object run(String op, Map<String, String> a, String id, Consumer<Object[]> sink) throws Exception {
        ensureUserConfig();
        try {
            switch (op) {
                case "available": return map("ok", Boolean.TRUE);
                case "status": return status(a);
                case "commit": return commit(a);
                case "log": return log(a);
                case "fetch": return fetch(a, id, sink);
                case "pull": return pull(a, id, sink);
                case "push": return push(a, id, sink);
                case "clone": return cloneRepo(a, id, sink);
                default: throw new IllegalArgumentException("Unknown git operation: " + op);
            }
        } finally {
            if (id != null) CANCELLED.remove(id);
        }
    }

    private static Object status(Map<String, String> a) throws Exception {
        try (Git git = open(arg(a, "dir"))) {
            Status st = git.status().call();
            Map<String, String> kinds = new HashMap<>();
            for (String p : st.getModified()) kinds.put(p, "modified");
            for (String p : st.getChanged()) kinds.put(p, "modified");
            for (String p : st.getConflicting()) kinds.put(p, "modified");
            for (String p : st.getAdded()) kinds.put(p, "new");
            for (String p : st.getUntracked()) kinds.put(p, "new");
            for (String p : st.getMissing()) kinds.put(p, "deleted");
            for (String p : st.getRemoved()) kinds.put(p, "deleted");
            List<Object> list = new ArrayList<>();
            for (Map.Entry<String, String> e : kinds.entrySet()) list.add(map("path", e.getKey(), "kind", e.getValue()));
            return map("changes", list);
        }
    }

    private static Object commit(Map<String, String> a) throws Exception {
        String message = arg(a, "message").trim();
        if (message.isEmpty()) throw new IllegalArgumentException("Write a commit message.");
        String name = arg(a, "name"), email = arg(a, "email");
        if (name.isEmpty() || email.isEmpty()) throw new IllegalArgumentException("Set your Git name and email first (Git > Identity).");
        try (Git git = open(arg(a, "dir"))) {
            List<String> adds = lines(arg(a, "adds"));
            List<String> removes = lines(arg(a, "removes"));
            if (adds.isEmpty() && removes.isEmpty()) throw new IllegalArgumentException("Nothing to commit.");
            if (!adds.isEmpty()) {
                org.eclipse.jgit.api.AddCommand add = git.add();
                for (String p : adds) add.addFilepattern(p);
                add.call();
            }
            if (!removes.isEmpty()) {
                org.eclipse.jgit.api.RmCommand rm = git.rm().setCached(true);
                for (String p : removes) rm.addFilepattern(p);
                rm.call();
            }
            PersonIdent who = new PersonIdent(name, email);
            RevCommit c = git.commit().setMessage(message).setAuthor(who).setCommitter(who).call();
            return map("oid", c.getName(), "count", adds.size() + removes.size());
        }
    }

    private static Object log(Map<String, String> a) throws Exception {
        int max = 25;
        try { max = Integer.parseInt(arg(a, "max")); } catch (Exception e) { /* default */ }
        try (Git git = open(arg(a, "dir"))) {
            List<Object> out = new ArrayList<>();
            if (git.getRepository().resolve("HEAD") == null) return map("commits", out);
            for (RevCommit c : git.log().setMaxCount(max).call()) {
                out.add(map("oid", c.getName(), "message", c.getFullMessage(), "name", c.getAuthorIdent().getName(),
                        "email", c.getAuthorIdent().getEmailAddress(), "time", (long) c.getCommitTime()));
            }
            return map("commits", out);
        }
    }

    private static Object fetch(Map<String, String> a, String id, Consumer<Object[]> sink) throws Exception {
        try (Git git = open(arg(a, "dir"))) {
            git.fetch().setRemote("origin").setCredentialsProvider(creds(a)).setProgressMonitor(new Monitor(id, sink)).setTimeout(60).call();
            return map("ok", Boolean.TRUE);
        }
    }

    private static Object pull(Map<String, String> a, String id, Consumer<Object[]> sink) throws Exception {
        try (Git git = open(arg(a, "dir"))) {
            // A merge commit made by pull takes its author from the repository config; without this it would be "root@localhost".
            StoredConfig cfg = git.getRepository().getConfig();
            String oldName = cfg.getString("user", null, "name"), oldEmail = cfg.getString("user", null, "email");
            String name = arg(a, "name"), email = arg(a, "email");
            boolean temp = !name.isEmpty() && !email.isEmpty() && (oldName == null || oldEmail == null);
            if (temp) { cfg.setString("user", null, "name", oldName == null ? name : oldName); cfg.setString("user", null, "email", oldEmail == null ? email : oldEmail); cfg.save(); }
            PullResult r;
            try {
                r = git.pull().setCredentialsProvider(creds(a)).setProgressMonitor(new Monitor(id, sink)).setTimeout(60).call();
            } finally {
                if (temp) {
                    if (oldName == null) cfg.unset("user", null, "name");
                    if (oldEmail == null) cfg.unset("user", null, "email");
                    cfg.save();
                }
            }
            MergeResult mr = r.getMergeResult();
            String status = mr == null ? "" : String.valueOf(mr.getMergeStatus());
            List<Object> conflicts = new ArrayList<>();
            if (mr != null && mr.getConflicts() != null) conflicts.addAll(mr.getConflicts().keySet());
            return map("ok", r.isSuccessful(), "status", status, "conflicts", conflicts);
        }
    }

    private static Object push(Map<String, String> a, String id, Consumer<Object[]> sink) throws Exception {
        try (Git git = open(arg(a, "dir"))) {
            String branch = arg(a, "branch");
            if (branch.isEmpty()) branch = git.getRepository().getBranch();
            boolean force = "1".equals(arg(a, "force"));
            Iterable<PushResult> results = git.push().setRemote("origin").setCredentialsProvider(creds(a))
                    .setProgressMonitor(new Monitor(id, sink)).setTimeout(60).setForce(force)
                    .add("refs/heads/" + branch + ":refs/heads/" + branch).call();
            Set<String> messages = new LinkedHashSet<>();
            boolean ok = true; String status = "OK"; String detail = "";
            for (PushResult pr : results) {
                String m = pr.getMessages();
                if (m != null) for (String l : m.split("\r?\n")) if (!l.trim().isEmpty()) messages.add(l.trim());
                for (RemoteRefUpdate u : pr.getRemoteUpdates()) {
                    RemoteRefUpdate.Status s = u.getStatus();
                    if (s != RemoteRefUpdate.Status.OK && s != RemoteRefUpdate.Status.UP_TO_DATE) {
                        ok = false; status = String.valueOf(s);
                        if (u.getMessage() != null) detail = u.getMessage();
                    } else if (s == RemoteRefUpdate.Status.UP_TO_DATE && ok) {
                        status = "UP_TO_DATE";
                    }
                }
            }
            return map("ok", ok, "status", status, "detail", detail, "messages", new ArrayList<Object>(messages));
        }
    }

    private static Object cloneRepo(Map<String, String> a, String id, Consumer<Object[]> sink) throws Exception {
        File dir = new File(arg(a, "dir"));
        String[] kids = dir.list();
        if (kids != null && kids.length > 0) throw new IllegalArgumentException("The folder is not empty.");
        String url = arg(a, "url");
        String branch = arg(a, "branch");
        int depth = 0;
        try { depth = Integer.parseInt(arg(a, "depth")); } catch (Exception e) { /* full clone */ }
        UsernamePasswordCredentialsProvider cp = creds(a);
        if (depth <= 0) {
            org.eclipse.jgit.api.CloneCommand c = Git.cloneRepository().setURI(url).setDirectory(dir)
                    .setCredentialsProvider(cp).setProgressMonitor(new Monitor(id, sink)).setTimeout(60);
            if (!branch.isEmpty()) c.setBranch(branch);
            try (Git git = c.call()) {
                StoredConfig cfg = git.getRepository().getConfig();
                cfg.setBoolean("core", null, "filemode", false);
                cfg.save();
                return map("ok", Boolean.TRUE, "branch", git.getRepository().getBranch());
            }
        }
        throw new IllegalArgumentException("Shallow clones are not supported by the native Git.");
    }
}
