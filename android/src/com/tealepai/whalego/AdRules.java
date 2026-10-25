package com.tealepai.whalego;

import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 纯 Java 的广告跳过标签判断，方便在 JVM 上直接跑用例。
 *
 * <p>判断策略参考了 MIT 许可的 zfdang/Android-Touch-Helper：先看完整标签，
 * 再看被拆成多个子节点的文字（例如「跳」「过」），最后才用广告上下文兜底。
 * 这里没有复制它的源文件。</p>
 */
public final class AdRules {
    private static final Pattern COUNTDOWN = Pattern.compile(
            "^(?:(\\d{1,3})\\s*(?:秒|s)?\\s*[|·:：\\-]?\\s*)?"
                    + "(跳过(?:广告)?|skip(?:\\s*ad)?)"
                    + "(?:\\s*[|·:：\\-]?\\s*(\\d{1,3})\\s*(?:秒|s)?)?$");

    private static final String[] EXPLICIT = {
            "跳过广告", "关闭广告", "skip ad", "close ad"
    };

    private static final String[] AD_MARKERS = {
            "广告", "推广", "adview", "ad_view", "ad_container", "adslot",
            "advert", "sponsor", "promo", "reward", "奖励"
    };

    private AdRules() {
    }

    public static String normalize(String raw) {
        if (raw == null) return "";
        String s = raw.replaceAll("[\u200B-\u200D\uFEFF]", "")
                .replaceAll("\\s+", " ")
                .trim()
                .toLowerCase(Locale.ROOT);
        return s;
    }

    /** 去掉分隔符与空白，用于兼容「跳 过」「35 | 跳过」这类拆分。 */
    public static String compact(String raw) {
        return normalize(raw).replaceAll("[\\s\\p{Z}·\\-_|/•\\[\\]()（）:：]+", "");
    }

    /**
     * 是否是可以点击的跳过/关闭标签。
     *
     * @param raw       节点文字或 contentDescription（可含倒计时）
     * @param adContext 父级是否出现广告语义
     */
    public static boolean isSkipLabel(String raw, boolean adContext) {
        String s = normalize(raw);
        if (s.isEmpty()) return false;
        if (containsAny(s, EXPLICIT)) return true;

        Matcher m = COUNTDOWN.matcher(s);
        if (m.matches()) {
            // 带数字的倒计时直接认；只有「跳过 / skip」两个字时必须先有广告上下文
            if (m.group(1) != null || m.group(3) != null) return true;
            if (adContext) return true;
        }

        String c = compact(s);
        if (c.contains("跳过") || c.contains("skip")) {
            boolean digit = c.matches(".*\\d.*");
            if (digit && c.length() <= 10) return true;
            if (adContext) return true;
        }
        return adContext && isCloseLabel(s);
    }

    public static boolean isCloseLabel(String raw) {
        String s = normalize(raw);
        return s.equals("x") || s.equals("×") || s.equals("✕") || s.equals("✖")
                || s.equals("关闭") || s.equals("close") || s.equals("close ad");
    }

    public static boolean hasAdMarker(String raw) {
        return containsAny(normalize(raw), AD_MARKERS);
    }

    /** 把 2~5 个子节点的文字拼起来，兼容「跳」「过」和「跳过」「5s」两种拆分。 */
    public static String joinChildren(List<? extends CharSequence> children) {
        if (children == null || children.size() < 2 || children.size() > 5) return "";
        StringBuilder sb = new StringBuilder(32);
        for (CharSequence part : children) {
            if (part == null) continue;
            String s = normalize(part.toString());
            if (!s.isEmpty()) sb.append(s);
            if (sb.length() >= 32) break;
        }
        return sb.toString();
    }

    private static boolean containsAny(String haystack, String... needles) {
        if (haystack == null) return false;
        for (String needle : needles) {
            if (haystack.contains(needle)) return true;
        }
        return false;
    }
}
