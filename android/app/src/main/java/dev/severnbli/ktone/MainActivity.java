package dev.severnbli.ktone;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final int REQUEST_MICROPHONE = 1;
    private FrameLayout container;
    private WebView tuner;
    private PermissionRequest pendingMicrophone;
    private boolean permissionDialogOpen;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        container = new FrameLayout(this);
        if (Build.VERSION.SDK_INT >= 35) {
            container.setOnApplyWindowInsetsListener((view, windowInsets) -> {
                Insets insets = windowInsets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(container);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    @SuppressWarnings("deprecation")
    private void handleBack() {
        WebView currentTuner = tuner;
        if (currentTuner == null) {
            super.onBackPressed();
            return;
        }
        // Each web sheet already closes on Escape and restores focus to its opener.
        currentTuner.evaluateJavascript("""
                (() => {
                    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
                    if (!dialog) return false;
                    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    return true;
                })()
                """, handled -> {
            if (currentTuner == tuner && !"true".equals(handled)) super.onBackPressed();
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onStart() {
        super.onStart();
        tuner = new WebView(this);
        WebSettings settings = tuner.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setUseWideViewPort(true);
        // Web Audio creates its AudioContext after the asynchronous microphone dialog.
        settings.setMediaPlaybackRequiresUserGesture(false);
        tuner.setWebViewClient(new AssetClient());
        tuner.setWebChromeClient(new MicrophoneClient());
        container.addView(tuner);
        tuner.loadUrl(BundledSite.HOME);
    }

    @Override
    protected void onStop() {
        // Release all capture tracks and oscillators when the Activity leaves the screen.
        // The next session restores the user's settings from same-origin DOM storage.
        if (pendingMicrophone != null) {
            pendingMicrophone.deny();
            pendingMicrophone = null;
        }
        container.removeView(tuner);
        tuner.destroy();
        tuner = null;
        super.onStop();
    }

    private static boolean isLocal(Uri uri) {
        return BundledSite.isLocal(uri.getScheme(), uri.getEncodedAuthority());
    }

    private final class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if ("GET".equals(request.getMethod()) && isLocal(uri)) {
                String path = BundledSite.assetPath(uri.getEncodedPath());
                if (path != null) {
                    try {
                        InputStream stream = getAssets().open(path);
                        String mime = BundledSite.mimeType(path);
                        String charset = mime.startsWith("text/") ? "UTF-8" : null;
                        return new WebResourceResponse(mime, charset, 200, "OK",
                                Collections.singletonMap("Cache-Control", "no-store"), stream);
                    } catch (IOException missing) {
                        // Return an offline 404 for missing packaged assets.
                    }
                }
            }
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    Collections.emptyMap(), null);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isLocal(uri)) return false;
            if (request.isForMainFrame() && request.hasGesture() && BundledSite.isAboutLink(uri.toString())) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
                } catch (ActivityNotFoundException ignored) {
                    // Devices without a browser can still use the tuner.
                }
            }
            return true;
        }
    }

    private final class MicrophoneClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            if (tuner == null || tuner.getWebChromeClient() != this || isFinishing()
                    || !isLocal(request.getOrigin()) || permissionDialogOpen
                    || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                request.deny();
                return;
            }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                grantMicrophone(request);
                return;
            }
            pendingMicrophone = request;
            permissionDialogOpen = true;
            requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, REQUEST_MICROPHONE);
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingMicrophone == request) pendingMicrophone = null;
        }
    }

    private static void grantMicrophone(PermissionRequest request) {
        request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_MICROPHONE) return;
        permissionDialogOpen = false;
        PermissionRequest request = pendingMicrophone;
        pendingMicrophone = null;
        if (request == null) return;
        if (grantResults.length == 1 && grantResults[0] == PackageManager.PERMISSION_GRANTED
                && !isFinishing() && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            grantMicrophone(request);
        } else {
            request.deny();
        }
    }
}
