package com.wesbos.homehq;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * A Cloudflare Access service token, so the panel needs no email + PIN sign-in. Access in strict
 * mode (every organization created since 2026-10-05, and it can't be turned off) returns no
 * session cookie, so each request must carry the headers. WebView can only add headers to the page
 * load, so the kiosk makes every request to the dashboard's origin itself through fetch().
 * WebView doesn't show a POST body to shouldInterceptRequest; the page repeats it in BODY_HEADER.
 *
 * Plain Java, no Android classes, so test-access.py can run it on a PC.
 */
final class AccessToken {
  /** Added to the user agent so the page knows to send BODY_HEADER. Never the token. */
  static final String UA_MARK = "HomeHQ-Access";
  static final String BODY_HEADER = "x-hq-body";
  static final int CONNECT_MS = 15000, READ_MS = 30000;
  private static final Pattern VALUE = Pattern.compile("[A-Za-z0-9._-]{8,200}");

  final String origin;
  private final String id, secret;

  /** What came back, in the shape WebResourceResponse wants. */
  static final class Reply {
    int status;
    String reason, mime, charset;
    final Map<String, String> headers = new HashMap<>();
    InputStream body;
  }

  private AccessToken(String origin, String id, String secret) {
    this.origin = origin;
    this.id = id;
    this.secret = secret;
  }

  /** Null unless the values look right and the origin is https. The token only ever goes there. */
  static AccessToken of(String origin, String id, String secret) {
    if (origin == null || !origin.startsWith("https://") || id == null || secret == null
        || !VALUE.matcher(id).matches() || !VALUE.matcher(secret).matches()) return null;
    return new AccessToken(origin, id, secret);
  }

  /** scheme://host[:port] in lower case, or null if the URL doesn't parse as a plain web URL. */
  static String origin(String url) {
    try {
      URI u = new URI(url);
      if (u.getScheme() == null || u.getHost() == null || u.getRawUserInfo() != null) return null;
      String scheme = u.getScheme().toLowerCase(Locale.ROOT);
      if (!scheme.equals("https") && !scheme.equals("http")) return null;
      int port = u.getPort();
      boolean usual = port == -1 || (scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80);
      return scheme + "://" + u.getHost().toLowerCase(Locale.ROOT) + (usual ? "" : ":" + port);
    } catch (URISyntaxException e) {
      return null;
    }
  }

  boolean covers(String url, String method) {
    return origin.equals(origin(url)) && ("GET".equals(method) || "HEAD".equals(method) || "POST".equals(method));
  }

  /**
   * Whether a request to the origin may carry the token. Any page in the WebView can ask for the
   * dashboard's URLs, and CORS doesn't apply to replies made here, so what counts is the document
   * asking. Opening the dashboard itself is always fine; a form POST from elsewhere is not.
   */
  static boolean allowed(boolean mainFrame, String method, boolean docTrusted) {
    return mainFrame ? "GET".equals(method) || "HEAD".equals(method) : docTrusted;
  }

  /** Access's own sign-in page, where it redirects a request with no token. */
  static boolean isSignIn(String url) {
    try {
      URI u = new URI(url);
      return u.getHost() != null && u.getHost().toLowerCase(Locale.ROOT).endsWith(".cloudflareaccess.com");
    } catch (URISyntaxException e) {
      return false;
    }
  }

  /** Throws IOException when the network fails; any answer from the server is a Reply. */
  Reply fetch(String url, String method, Map<String, String> asked, boolean page) throws IOException {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setRequestMethod(method);
    c.setInstanceFollowRedirects(false);
    c.setConnectTimeout(CONNECT_MS);
    c.setReadTimeout(READ_MS);
    c.setRequestProperty("CF-Access-Client-Id", id);
    c.setRequestProperty("CF-Access-Client-Secret", secret);
    c.setRequestProperty("Accept", header(asked, "accept", "*/*"));
    String ua = header(asked, "user-agent", null);
    if (ua != null) c.setRequestProperty("User-Agent", ua);
    if ("POST".equals(method)) {
      String body = header(asked, BODY_HEADER, "");
      byte[] bytes = URLDecoder.decode(body, "UTF-8").getBytes(StandardCharsets.UTF_8);
      c.setRequestProperty("Origin", origin); // the Worker refuses writes from any other origin
      c.setRequestProperty("Content-Type", header(asked, "content-type", "application/json"));
      c.setDoOutput(true);
      c.setFixedLengthStreamingMode(bytes.length);
      try (OutputStream out = c.getOutputStream()) { out.write(bytes); }
    }
    return reply(c, page);
  }

  private static Reply reply(HttpURLConnection c, boolean page) throws IOException {
    Reply r = new Reply();
    r.status = c.getResponseCode();
    // WebResourceResponse refuses 3xx. Here a redirect only means Access wants a sign-in.
    boolean refused = r.status == 401 || r.status == 403 || (r.status >= 300 && r.status < 400);
    if (r.status >= 300 && r.status < 400) r.status = 401;
    // It also refuses an empty reason, which HTTP/2 answers have.
    r.reason = r.status < 300 ? "OK" : refused ? "Unauthorized" : "Error";
    String type = c.getContentType();
    r.mime = "application/octet-stream";
    if (type != null) {
      String[] parts = type.split(";");
      r.mime = parts[0].trim();
      for (int i = 1; i < parts.length; i++) {
        String p = parts[i].trim();
        if (p.toLowerCase(Locale.ROOT).startsWith("charset=")) r.charset = p.substring(8).replace("\"", "");
      }
    }
    for (Map.Entry<String, List<String>> h : c.getHeaderFields().entrySet()) {
      String name = h.getKey();
      if (name == null) continue;
      String low = name.toLowerCase(Locale.ROOT);
      // The body handed over is already decoded and de-chunked; cookies stay out of WebView.
      if (low.equals("content-encoding") || low.equals("content-length") || low.equals("transfer-encoding")
          || low.equals("connection") || low.equals("set-cookie") || low.equals("location")) continue;
      StringBuilder value = new StringBuilder(); // String.join needs API 26; the kiosk runs on 23
      for (String v : h.getValue()) value.append(value.length() > 0 ? ", " : "").append(v);
      r.headers.put(name, value.toString());
    }
    if (refused && page) {
      r.mime = "text/html";
      r.charset = "utf-8";
      r.headers.clear();
      r.body = new ByteArrayInputStream(REFUSED.getBytes(StandardCharsets.UTF_8));
      return r;
    }
    InputStream in = r.status >= 400 ? c.getErrorStream() : c.getInputStream();
    r.body = in != null ? in : new ByteArrayInputStream(new byte[0]);
    return r;
  }

  private static String header(Map<String, String> asked, String name, String fallback) {
    if (asked != null) {
      for (Map.Entry<String, String> h : asked.entrySet()) {
        if (name.equalsIgnoreCase(h.getKey())) return h.getValue();
      }
    }
    return fallback;
  }

  // Shown on the panel instead of a blank page. Tries again by itself, so a new token just works.
  private static final String REFUSED = "<!doctype html><meta http-equiv=refresh content=300>"
      + "<body style='background:#111;color:#eee;font:24px sans-serif;padding:2em'>"
      + "<h1>Cloudflare refused this frame's token</h1>"
      + "<p>It may have expired or been deleted. This page tries again every 5 minutes.</p>";
}
