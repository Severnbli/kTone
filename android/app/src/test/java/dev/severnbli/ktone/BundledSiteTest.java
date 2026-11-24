package dev.severnbli.ktone;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class BundledSiteTest {
    @Test
    public void onlyTheBundledHttpsOriginCanLoadAssetsOrUseTheMicrophone() {
        assertTrue(BundledSite.isLocal("https", "appassets.androidplatform.net"));
        assertTrue(BundledSite.isLocal("https", "appassets.androidplatform.net:443"));
        assertFalse(BundledSite.isLocal("http", "appassets.androidplatform.net"));
        assertFalse(BundledSite.isLocal("https", "appassets.androidplatform.net:8443"));
        assertFalse(BundledSite.isLocal("https", "appassets.androidplatform.net.other.example"));
        assertFalse(BundledSite.isLocal("https", "appassets.androidplatform.net@other.example"));
        assertFalse(BundledSite.isLocal("file", null));
    }

    @Test
    public void resolvesOnlyBuildOutputPaths() {
        assertEquals("index.html", BundledSite.assetPath("/"));
        assertEquals("pitch-worklet.js", BundledSite.assetPath("/pitch-worklet.js"));
        assertEquals("assets/ktone_wasm_bg-Dm4NJq8_.wasm",
                BundledSite.assetPath("/assets/ktone_wasm_bg-Dm4NJq8_.wasm"));
        assertNull(BundledSite.assetPath("/../index.html"));
        assertNull(BundledSite.assetPath("/assets/%2e%2e/index.html"));
        assertNull(BundledSite.assetPath("//index.html"));
    }

    @Test
    public void servesWorkletsModulesStylesAndWasmWithBrowserMimeTypes() {
        assertEquals("text/html", BundledSite.mimeType("index.html"));
        assertEquals("text/javascript", BundledSite.mimeType("pitch-worklet.js"));
        assertEquals("application/wasm", BundledSite.mimeType("assets/ktone_wasm_bg.wasm"));
        assertEquals("text/css", BundledSite.mimeType("assets/index.css"));
        assertEquals("image/png", BundledSite.mimeType("icons/icon-192.png"));
    }

    @Test
    public void onlySourceAndLicenseLinksCanOpenTheBrowser() {
        String source = "https://github.com/Severnbli/kTone";
        assertTrue(BundledSite.isAboutLink(source));
        assertTrue(BundledSite.isAboutLink(source + "/blob/main/LICENSE"));
        assertFalse(BundledSite.isAboutLink(source + ".example"));
        assertFalse(BundledSite.isAboutLink("intent://github.com/Severnbli/kTone"));
    }
}
