package com.tealepai.whalego;

import android.accessibilityservice.AccessibilityService;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 学习项目：只识别带有广告上下文的“跳过 / 关闭广告”控件并点击。
 * 不做截图、不读输入内容、不上传任何数据。
 */
public class AdAccessibilityService extends AccessibilityService {
    private static final String TAG = "WhaleGo";
    private static final Pattern COUNTDOWN_SKIP =
            Pattern.compile("^(跳过|skip)\\s*\\d+\\s*(秒|s)?$");
    private static volatile boolean running = false;
    private long lastClick = 0L;

    public static boolean isRunning() {
        return running;
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = true;
        Log.i(TAG, "accessibility connected");
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public void onInterrupt() {
        // no-op
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        CharSequence pkg = event.getPackageName();
        if (pkg != null && pkg.toString().toLowerCase(Locale.ROOT).contains("whalego")) return;

        int type = event.getEventType();
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return;

        long now = SystemClock.uptimeMillis();
        if (now - lastClick < 350L) return;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        if (scan(root, 0, new int[]{0})) {
            lastClick = now;
            Log.i(TAG, "ad close control clicked");
        }
    }

    private boolean scan(AccessibilityNodeInfo node, int depth, int[] count) {
        if (node == null || depth > 36 || count[0] > 800) return false;
        count[0]++;
        if (node.isVisibleToUser()) {
            String label = labelOf(node);
            if (label.length() > 0 && isActionable(label, node) && click(node)) return true;
        }
        int children = node.getChildCount();
        for (int i = 0; i < children; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            if (scan(child, depth + 1, count)) return true;
        }
        return false;
    }

    private String labelOf(AccessibilityNodeInfo node) {
        StringBuilder sb = new StringBuilder();
        CharSequence text = node.getText();
        CharSequence desc = node.getContentDescription();
        if (text != null) sb.append(text).append(' ');
        if (desc != null) sb.append(desc).append(' ');
        return sb.toString().trim().toLowerCase(Locale.ROOT);
    }

    private String idOf(AccessibilityNodeInfo node) {
        CharSequence id = node.getViewIdResourceName();
        return id == null ? "" : id.toString().toLowerCase(Locale.ROOT);
    }

    private boolean isActionable(String label, AccessibilityNodeInfo node) {
        String s = label.trim();
        if (containsAny(s, "跳过广告", "关闭广告", "skip ad", "close ad")) return true;
        // 带秒数的“跳过 5s / 跳过5秒”本身就是广告倒计时，不再要求上下文
        if (COUNTDOWN_SKIP.matcher(s).matches()) return true;
        // 单字“跳过 / 关闭 / ×”必须先确认周围有广告语义，避免误点教程与系统弹窗
        boolean adContext = hasAdContext(node.getParent(), 1);
        if (!adContext) return false;
        if (containsAny(s, "跳过", "skip")) return true;
        return isCloseLabel(s);
    }

    private boolean isCloseLabel(String label) {
        String s = label.trim();
        if (s.equals("x") || s.equals("×") || s.equals("✕") || s.equals("✖")) return true;
        if (s.equals("关闭") || s.equals("close") || s.equals("close ad")) return true;
        return false;
    }

    private boolean hasAdContext(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 6) return false;
        String marker = labelOf(node) + " " + idOf(node);
        if (containsAny(marker, "广告", "adview", "ad_view", "ad_container", "adslot",
                "advert", "sponsor", "promo", "reward", "奖励")) {
            return true;
        }
        return hasAdContext(node.getParent(), depth + 1);
    }

    private boolean click(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo current = node;
        for (int i = 0; i < 3 && current != null; i++) {
            if (current.isClickable() && current.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                return true;
            }
            current = current.getParent();
        }
        return false;
    }

    private boolean containsAny(String haystack, String... needles) {
        if (haystack == null) return false;
        for (String needle : needles) {
            if (haystack.contains(needle)) return true;
        }
        return false;
    }
}
