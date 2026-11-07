#!/usr/bin/env python3
"""Run AccessToken.java against a real local HTTP server.

Requires Python 3 and a JDK on PATH. No Android device or SDK. Checks the token logic and the
request forwarding, not WebView's handling of the reply or Cloudflare itself.
"""
from pathlib import Path
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parent / "src/com/wesbos/homehq/AccessToken.java"

HARNESS = r'''
package com.wesbos.homehq;

import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class AccessHarness {
  static final String ID = "abc123.access", SECRET = "cfast_0123456789abcdef";
  static int failures;
  static void check(String what, boolean ok) {
    System.out.println((ok ? "ok   " : "FAIL ") + what);
    if (!ok) failures++;
  }
  static String read(InputStream in) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] b = new byte[4096];
    for (int n; (n = in.read(b)) > 0; ) out.write(b, 0, n);
    return new String(out.toByteArray(), StandardCharsets.UTF_8);
  }

  public static void main(String[] a) throws Exception {
    // Origins
    check("origin lower-cases", "https://home.example.dev".equals(AccessToken.origin("HTTPS://Home.Example.dev/x?y=1")));
    check("origin drops default port", "https://a.dev".equals(AccessToken.origin("https://a.dev:443/")));
    check("origin keeps other port", "https://a.dev:8443".equals(AccessToken.origin("https://a.dev:8443/")));
    check("origin refuses user info", AccessToken.origin("https://good.dev@evil.dev/") == null);
    check("origin refuses backslash trick", AccessToken.origin("https://good.dev\\@evil.dev/") == null);
    check("origin refuses file:", AccessToken.origin("file:///data/x") == null);

    // Saving
    check("http origin refused", AccessToken.of("http://a.dev", ID, SECRET) == null);
    check("no origin refused", AccessToken.of(null, ID, SECRET) == null);
    check("missing secret refused", AccessToken.of("https://a.dev", ID, null) == null);
    check("shell characters refused", AccessToken.of("https://a.dev", ID, "abcdefgh;reboot") == null);
    check("old hex secret accepted", AccessToken.of("https://a.dev", ID, "0123456789abcdef0123456789abcdef") != null);

    // Only the saved origin, only these methods
    AccessToken t = AccessToken.of("https://a.dev", ID, SECRET);
    check("covers own origin", t.covers("https://a.dev/api/chores", "GET"));
    check("covers POST", t.covers("https://a.dev/api/chores/1", "POST"));
    check("not another host", !t.covers("https://evil.dev/", "GET"));
    check("not a lookalike host", !t.covers("https://a.dev.evil.dev/", "GET"));
    check("not plain http", !t.covers("http://a.dev/", "GET"));
    check("not user info", !t.covers("https://a.dev@evil.dev/", "GET"));
    check("not OPTIONS", !t.covers("https://a.dev/", "OPTIONS"));

    // Who may use it
    check("opening the dashboard from anywhere", AccessToken.allowed(true, "GET", false));
    check("form POST from another page refused", !AccessToken.allowed(true, "POST", false));
    check("form POST never, even from the dashboard", !AccessToken.allowed(true, "POST", true));
    check("dashboard's own requests", AccessToken.allowed(false, "POST", true) && AccessToken.allowed(false, "GET", true));
    check("another page's fetch refused", !AccessToken.allowed(false, "GET", false) && !AccessToken.allowed(false, "POST", false));

    // The sign-in page
    check("sign-in page seen", AccessToken.isSignIn("https://team.cloudflareaccess.com/cdn-cgi/access/login/a.dev?kid=1"));
    check("dashboard is not the sign-in page", !AccessToken.isSignIn("https://a.dev/"));
    check("lookalike is not the sign-in page", !AccessToken.isSignIn("https://cloudflareaccess.com.evil.dev/"));

    // Forwarding, against a real server
    final Map<String, String> got = new HashMap<>();
    HttpServer s = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    s.createContext("/", x -> {
      got.clear();
      got.put("method", x.getRequestMethod());
      for (String h : new String[] {"CF-Access-Client-Id", "CF-Access-Client-Secret", "Origin", "Content-Type", "Cookie", "x-hq-body"})
        got.put(h, x.getRequestHeaders().getFirst(h));
      got.put("body", read(x.getRequestBody()));
      String p = x.getRequestURI().getPath();
      x.getResponseHeaders().add("Set-Cookie", "CF_Authorization=x");
      x.getResponseHeaders().add("x-build", "v1");
      byte[] b = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
      if (p.equals("/moved")) {
        x.getResponseHeaders().add("Location", "https://team.cloudflareaccess.com/cdn-cgi/access/login");
        x.sendResponseHeaders(302, -1);
      } else if (p.equals("/denied")) {
        x.sendResponseHeaders(403, -1);
      } else if (p.equals("/broken")) {
        x.sendResponseHeaders(503, b.length);
        x.getResponseBody().write(b);
      } else {
        x.getResponseHeaders().add("Content-Type", "application/json; charset=UTF-8");
        x.sendResponseHeaders(200, b.length);
        x.getResponseBody().write(b);
      }
      x.close();
    });
    s.start();
    String base = "http://127.0.0.1:" + s.getAddress().getPort();

    AccessToken.Reply r = t.fetch(base + "/api/config", "GET", new HashMap<>(), false);
    check("GET status", r.status == 200 && "OK".equals(r.reason));
    check("GET sends id and secret", ID.equals(got.get("CF-Access-Client-Id")) && SECRET.equals(got.get("CF-Access-Client-Secret")));
    check("GET parses type", "application/json".equals(r.mime) && "UTF-8".equals(r.charset));
    check("GET body", "{\"ok\":true}".equals(read(r.body)));
    check("x-build reaches the page", "v1".equals(r.headers.get("X-build")) || "v1".equals(r.headers.get("x-build")));
    check("no Set-Cookie to the page", r.headers.keySet().stream().noneMatch(k -> k.equalsIgnoreCase("set-cookie")));
    check("no Content-Length to the page", r.headers.keySet().stream().noneMatch(k -> k.equalsIgnoreCase("content-length")));

    Map<String, String> asked = new HashMap<>();
    asked.put("Content-Type", "application/json");
    asked.put("X-HQ-Body", "%7B%22name%22%3A%22caf%C3%A9%20%E7%89%9B%E5%A5%B6%2B1%22%7D");
    t.fetch(base + "/api/shopping", "POST", asked, false);
    check("POST method", "POST".equals(got.get("method")));
    check("POST body decoded, UTF-8, + kept", "{\"name\":\"café 牛奶+1\"}".equals(got.get("body")));
    check("POST Origin is the dashboard's", "https://a.dev".equals(got.get("Origin")));
    check("POST type", "application/json".equals(got.get("Content-Type")));
    check("body header not forwarded", got.get("x-hq-body") == null);

    r = t.fetch(base + "/moved", "GET", new HashMap<>(), false);
    check("redirect becomes 401 (WebView refuses 3xx)", r.status == 401 && !r.reason.isEmpty());
    check("redirect target hidden", r.headers.keySet().stream().noneMatch(k -> k.equalsIgnoreCase("location")));
    check("redirect body empty", read(r.body).isEmpty());

    r = t.fetch(base + "/denied", "GET", new HashMap<>(), false);
    check("403 stays 403 for the API", r.status == 403);

    r = t.fetch(base + "/denied", "GET", new HashMap<>(), true);
    check("page load refused shows a message", r.status == 403 && "text/html".equals(r.mime) && read(r.body).contains("refused"));
    check("message page holds no secret", !read(t.fetch(base + "/moved", "GET", new HashMap<>(), true).body).contains(SECRET));

    r = t.fetch(base + "/broken", "GET", new HashMap<>(), true);
    check("503 passes through", r.status == 503 && "{\"ok\":true}".equals(read(r.body)));

    s.stop(0);
    boolean threw = false;
    try { t.fetch(base + "/", "GET", new HashMap<>(), true); } catch (IOException e) { threw = true; }
    check("network failure throws (kiosk falls back to WebView)", threw);

    if (failures > 0) throw new AssertionError(failures + " failed");
    System.out.println("all passed");
  }
}
'''

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    pkg = root / "com/wesbos/homehq"
    pkg.mkdir(parents=True)
    (pkg / "AccessToken.java").write_text(SOURCE.read_text(encoding="utf-8"), encoding="utf-8")
    (pkg / "AccessHarness.java").write_text(HARNESS, encoding="utf-8")
    subprocess.run(["javac", "-encoding", "UTF-8", "-nowarn", "-d", str(root / "out"),
                    str(pkg / "AccessToken.java"), str(pkg / "AccessHarness.java")], check=True)
    subprocess.run(["java", "-Dsun.net.http.allowRestrictedHeaders=true", "-cp", str(root / "out"), "com.wesbos.homehq.AccessHarness"], check=True)
