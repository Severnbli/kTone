package dev.severnbli.ktone;

import java.net.URLConnection;
import java.util.regex.Pattern;

final class BundledSite {
    private static final String HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + HOST + "/";
    private static final String SOURCE = "https://github.com/Severnbli/kTone";
    private static final Pattern ASSET_PATH =
            Pattern.compile("(?:/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)+");

    private BundledSite() {}

    static boolean isLocal(String scheme, String authority) {
        return "https".equals(scheme) && (HOST.equals(authority) || (HOST + ":443").equals(authority));
    }

    static String assetPath(String encodedPath) {
        if ("/".equals(encodedPath)) return "index.html";
        if (encodedPath == null || !ASSET_PATH.matcher(encodedPath).matches()) return null;
        return encodedPath.substring(1);
    }

    static String mimeType(String path) {
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        String mime = URLConnection.guessContentTypeFromName(path);
        return mime == null ? "application/octet-stream" : mime;
    }

    static boolean isAboutLink(String url) {
        return SOURCE.equals(url) || (SOURCE + "/blob/main/LICENSE").equals(url);
    }
}
