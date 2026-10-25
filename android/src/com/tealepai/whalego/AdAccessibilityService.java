package com.tealepai.whalego;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 学习项目：只识别带有广告上下文的“跳过 / 关闭广告”控件并点击。
 * 不做截图、不读输入内容、不上传任何数据。
 *
 * <p>标签判断在 {@link AdRules}，本类负责遍历节点、找可点击祖先，
 * 以及在 performAction 无效时用无障碍手势做一次真实点击。
 * “先 performAction、再 dispatchGesture”的思路参考 MIT 许可的
 * zfdang/Android-Touch-Helper；未复制其源文件。</p>
 */
public class AdAccessibilityService extends AccessibilityService {
    private static final String TAG = "WhaleGo";
    private static volatile boolean running = false;
    private static volatile String lastPackage = "";
    private static volatile String lastLabel = "";
    private static volatile String lastAction = "";
    private static volatile int eventsSeen = 0;
    private static volatile int labelsSeen = 0;
    private static volatile int clicks = 0;
    private static volatile int gestures = 0;

    private long lastScanAt = 0L;
    private long lastClickAt = 0L;
    private String lastClickKey = "";
    private long lastClickKeyAt = 0L;
    private boolean lastPerformReturned = false;

    public static boolean isRunning() {
        return running;
    }

    /** 给应用内诊断面板读的计数，不包含输入内容。 */
    public static String debugSnapshot() {
        return "events=" + eventsSeen
                + ";labels=" + labelsSeen
                + ";clicks=" + clicks
                + ";gestures=" + gestures
                + ";last=" + lastAction
                + ";pkg=" + lastPackage
                + ";text=" + lastLabel;
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
        String packageName = pkg == null ? "" : pkg.toString();
        if (packageName.toLowerCase(Locale.ROOT).contains("whalego")) return;

        int type = event.getEventType();
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return;

        long now = SystemClock.uptimeMillis();
        if (now - lastScanAt < 120L) return;
        lastScanAt = now;
        eventsSeen++;
        lastPackage = packageName;

        boolean handled = false;
        // 弹窗 / 广告 SDK 有时不在 active window 的根节点下，逐个窗口找一遍。
        java.util.List<AccessibilityWindowInfo> windows = getWindows();
        if (windows != null && !windows.isEmpty()) {
            for (AccessibilityWindowInfo window : windows) {
                if (window == null) continue;
                AccessibilityNodeInfo root = window.getRoot();
                if (root != null && scan(root, 0, new int[]{0})) {
                    handled = true;
                    break;
                }
            }
        }
        if (!handled) {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root != null) handled = scan(root, 0, new int[]{0});
        }
        if (handled) {
            lastClickAt = now;
            Log.i(TAG, "ad close control handled");
        }
    }

    private boolean scan(AccessibilityNodeInfo node, int depth, int[] count) {
        if (node == null || depth > 40 || count[0] > 1200) return false;
        count[0]++;

        if (node.isVisibleToUser()) {
            String own = labelOf(node);
            String label = own;
            if (label.isEmpty() && node.getChildCount() >= 2 && node.getChildCount() <= 5
                    && isSmallEnough(node)) {
                label = AdRules.joinChildren(childTexts(node));
            }
            if (!label.isEmpty()) {
                labelsSeen++;
                lastLabel = label;
                boolean adContext = AdRules.hasAdMarker(own + " " + idOf(node))
                        || hasAdContext(node.getParent(), 3);
                if (AdRules.isSkipLabel(label, adContext) && click(node)) {
                    lastAction = "hit:" + label;
                    return true;
                }
            }
        }

        int children = node.getChildCount();
        for (int i = 0; i < children; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            if (scan(child, depth + 1, count)) return true;
        }
        return false;
    }

    private List<String> childTexts(AccessibilityNodeInfo node) {
        List<String> out = new ArrayList<>();
        int n = node.getChildCount();
        for (int i = 0; i < n && i < 5; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            String t = labelOf(child);
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    private String labelOf(AccessibilityNodeInfo node) {
        StringBuilder sb = new StringBuilder();
        CharSequence text = node.getText();
        CharSequence desc = node.getContentDescription();
        if (text != null) sb.append(text).append(' ');
        if (desc != null) sb.append(desc).append(' ');
        return AdRules.normalize(sb.toString());
    }

    private String idOf(AccessibilityNodeInfo node) {
        CharSequence id = node.getViewIdResourceName();
        return id == null ? "" : id.toString().toLowerCase(Locale.ROOT);
    }

    private boolean hasAdContext(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 6) return false;
        if (AdRules.hasAdMarker(labelOf(node) + " " + idOf(node))) return true;
        return hasAdContext(node.getParent(), depth + 1);
    }

    private boolean isSmallEnough(AccessibilityNodeInfo node) {
        Rect b = new Rect();
        node.getBoundsInScreen(b);
        DisplayMetrics dm = getResources().getDisplayMetrics();
        return b.width() > 0 && b.height() > 0
                && b.width() <= dm.widthPixels * 0.85f
                && b.height() <= dm.heightPixels * 0.35f;
    }

    /**
     * 先对节点及其 5 层内可点击祖先做 ACTION_CLICK。
     * 如果系统说成功但同一个控件下一轮还在，就改用真实手势点一次。
     */
    private boolean click(AccessibilityNodeInfo node) {
        long now = SystemClock.uptimeMillis();
        if (now - lastClickAt < 350L) return false;

        String key = keyOf(node);
        if (key.equals(lastClickKey) && lastPerformReturned
                && now - lastClickKeyAt < 1600L) {
            lastPerformReturned = false;
            lastClickKey = "";
            return tap(node);
        }

        AccessibilityNodeInfo current = node;
        for (int i = 0; i < 6 && current != null; i++) {
            if (current.isVisibleToUser() && current.isEnabled() && current.isClickable()
                    && boundsOk(current)
                    && current.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                clicks++;
                lastPerformReturned = true;
                lastClickKey = key;
                lastClickKeyAt = now;
                return true;
            }
            current = current.getParent();
        }

        lastPerformReturned = false;
        lastClickKey = "";
        return tap(node);
    }

    private boolean tap(AccessibilityNodeInfo node) {
        if (!boundsOk(node)) return false;
        Rect b = new Rect();
        node.getBoundsInScreen(b);
        if (b.width() <= 0 || b.height() <= 0) return false;
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int x = Math.max(0, Math.min(dm.widthPixels - 1, b.centerX()));
        int y = Math.max(0, Math.min(dm.heightPixels - 1, b.centerY()));
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription gesture = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0L, 24L))
                .build();
        boolean sent = dispatchGesture(gesture, null, null);
        if (sent) {
            gestures++;
            clicks++;
            lastAction = "gesture";
        }
        return sent;
    }

    private boolean boundsOk(AccessibilityNodeInfo node) {
        Rect b = new Rect();
        node.getBoundsInScreen(b);
        DisplayMetrics dm = getResources().getDisplayMetrics();
        return b.width() > 0 && b.height() > 0
                && b.width() <= dm.widthPixels * 0.9f
                && b.height() <= dm.heightPixels * 0.5f;
    }

    private String keyOf(AccessibilityNodeInfo node) {
        Rect b = new Rect();
        node.getBoundsInScreen(b);
        // 倒计时文字会缩短按钮宽度，用左上角 + id 判断“还是同一个控件”
        return idOf(node) + "@" + b.left + "," + b.top;
    }
}
