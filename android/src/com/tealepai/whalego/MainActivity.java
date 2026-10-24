package com.tealepai.whalego;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String APP_HOST = "whalego.local";
    private static final String START_URL = "https://" + APP_HOST + "/index.html";

    private WebView web;
    private SharedPreferences prefs;
    private int bottomInset;
    private boolean lastSystemDark;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("whalego", MODE_PRIVATE);
        lastSystemDark = systemDark();

        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            window.getDecorView().setForceDarkAllowed(false);
        }
        applyBarAppearance(false);

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setLongClickable(false);
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                return true;
            }
        });

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.addJavascriptInterface(new Bridge(), "whale");
        web.setWebViewClient(new LocalClient());
        setContentView(web);

        installInsetsListener();
        web.loadUrl(START_URL);
    }

    private void installInsetsListener() {
        final View decor = getWindow().getDecorView();
        decor.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int bottom;
                if (Build.VERSION.SDK_INT >= 30) {
                    Insets bars = insets.getInsets(
                            WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                    bottom = bars.bottom;
                } else {
                    bottom = insets.getSystemWindowInsetBottom();
                }
                setBottomInset(bottom);
                return insets;
            }
        });
        decor.requestApplyInsets();
    }

    private void setBottomInset(int px) {
        if (px == bottomInset) return;
        bottomInset = px;
        runJs("window.whaleInsetsChanged&&window.whaleInsetsChanged(" + px + ")");
    }

    private void runJs(String code) {
        if (web == null) return;
        final String script = code;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(script, null);
            }
        });
    }

    private boolean systemDark() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applyBarAppearance(boolean dark) {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller == null) return;
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance(dark ? 0 : mask, mask);
        } else {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (!dark) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        runJs("window.whaleResume&&window.whaleResume()");
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        boolean dark = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        if (dark != lastSystemDark) {
            lastSystemDark = dark;
            runJs("window.whaleSystemDarkChanged&&window.whaleSystemDarkChanged(" + dark + ")");
        }
        getWindow().getDecorView().requestApplyInsets();
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){try{return !!(window.whaleBack&&window.whaleBack())}catch(e){return false}})()",
                new android.webkit.ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"true".equals(value)) finish();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("whale");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request == null) return null;
            Uri uri = request.getUrl();
            if (uri == null || !APP_HOST.equals(uri.getHost())) return null;
            if (!"GET".equalsIgnoreCase(request.getMethod())) return null;

            String path = uri.getPath();
            if (path == null || path.length() == 0 || "/".equals(path)) path = "/index.html";
            String assetPath = path.startsWith("/") ? path.substring(1) : path;
            if (assetPath.contains("..") || assetPath.contains("\\")) return notFound();

            try {
                InputStream in = getAssets().open(assetPath);
                String mime = mimeOf(assetPath);
                String encoding = mime.startsWith("text/")
                        || mime.contains("javascript") || mime.contains("json") ? "UTF-8" : null;
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                return new WebResourceResponse(mime, encoding, 200, "OK", headers, in);
            } catch (Exception e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request == null ? null : request.getUrl();
            return uri == null || !APP_HOST.equals(uri.getHost());
        }
    }

    private class Bridge {
        @JavascriptInterface
        public boolean isAccessibilityEnabled() {
            if (AdAccessibilityService.isRunning()) return true;
            AccessibilityManager manager =
                    (AccessibilityManager) getSystemService(ACCESSIBILITY_SERVICE);
            if (manager == null) return false;
            List<AccessibilityServiceInfo> services = manager.getEnabledAccessibilityServiceList(
                    AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
            if (services == null) return false;
            for (AccessibilityServiceInfo info : services) {
                if (info == null || info.getResolveInfo() == null
                        || info.getResolveInfo().serviceInfo == null) continue;
                android.content.pm.ServiceInfo service = info.getResolveInfo().serviceInfo;
                ComponentName name = new ComponentName(service.packageName, service.name);
                if (getPackageName().equals(name.getPackageName())
                        && AdAccessibilityService.class.getName().equals(name.getClassName())) {
                    return true;
                }
            }
            return false;
        }

        @JavascriptInterface
        public void openAccessibilitySettings() {
            try {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void openGithub() {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://github.com/JumpTea/whalego")));
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    finish();
                }
            });
        }

        @JavascriptInterface
        public String getPrefs() {
            return prefs.getString("prefs_json", "");
        }

        @JavascriptInterface
        public void savePrefs(String json) {
            if (json == null || json.length() > 8192) return;
            prefs.edit().putString("prefs_json", json).apply();
        }

        @JavascriptInterface
        public boolean getSystemDark() {
            return systemDark();
        }

        @JavascriptInterface
        public void setBarsDark(final boolean dark) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyBarAppearance(dark);
                }
            });
        }

        @JavascriptInterface
        public int getBottomInset() {
            return bottomInset;
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void setWallpaper(final String id, final int target) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    boolean ok = false;
                    String message = "";
                    InputStream in = null;
                    try {
                        if (id == null || !id.matches("[A-Za-z0-9_-]{1,64}")) {
                            throw new IllegalArgumentException("bad id");
                        }
                        WallpaperManager manager =
                                WallpaperManager.getInstance(getApplicationContext());
                        if (Build.VERSION.SDK_INT >= 23 && !manager.isWallpaperSupported()) {
                            throw new IllegalStateException("unsupported");
                        }
                        if (Build.VERSION.SDK_INT >= 24 && !manager.isSetWallpaperAllowed()) {
                            throw new IllegalStateException("blocked");
                        }
                        in = getAssets().open("wallpapers/full/" + id + ".webp");
                        if (Build.VERSION.SDK_INT >= 24) {
                            int which = target == 2
                                    ? WallpaperManager.FLAG_LOCK : WallpaperManager.FLAG_SYSTEM;
                            manager.setStream(in, null, true, which);
                        } else {
                            manager.setStream(in);
                        }
                        ok = true;
                    } catch (Throwable t) {
                        message = t.getClass().getSimpleName();
                    } finally {
                        if (in != null) {
                            try {
                                in.close();
                            } catch (Exception ignored) {
                            }
                        }
                    }
                    final boolean success = ok;
                    final String note = message;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (web == null) return;
                            web.evaluateJavascript(
                                    "window.whaleSyncResult&&window.whaleSyncResult("
                                            + success + "," + JSONObject.quote(note) + ")",
                                    null);
                        }
                    });
                }
            }, "wallpaper-sync").start();
        }
    }
}
