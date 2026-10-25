package com.tealepai.whalego;

import java.util.Arrays;

/** 纯 JVM 用例，不依赖 Android。运行：javac AdRules.java AdRulesTest.java && java AdRulesTest */
public final class AdRulesTest {
    private static int failed = 0;

    private static void check(String name, boolean actual, boolean expected) {
        if (actual != expected) {
            failed++;
            System.out.println("FAIL " + name + " expected=" + expected + " actual=" + actual);
        } else {
            System.out.println("PASS " + name);
        }
    }

    public static void main(String[] args) {
        check("pdd countdown 35 | 跳过", AdRules.isSkipLabel("35 | 跳过", false), true);
        check("pdd countdown 35s | 跳过", AdRules.isSkipLabel("35s | 跳过", false), true);
        check("countdown 跳过 5s", AdRules.isSkipLabel("跳过 5s", false), true);
        check("countdown 跳过 5 秒", AdRules.isSkipLabel("跳过 5 秒", false), true);
        check("countdown 5 秒跳过", AdRules.isSkipLabel("5 秒跳过", false), true);
        check("skip with context", AdRules.isSkipLabel("跳过", true), true);
        check("skip without context", AdRules.isSkipLabel("跳过", false), false);
        check("tutorial is not ad", AdRules.isSkipLabel("跳过教程", false), false);
        check("explicit skip ad", AdRules.isSkipLabel("跳过广告", false), true);
        check("explicit close ad", AdRules.isSkipLabel("关闭广告", false), true);
        check("close with context", AdRules.isSkipLabel("关闭", true), true);
        check("close without context", AdRules.isSkipLabel("关闭", false), false);
        check("x with context", AdRules.isSkipLabel("×", true), true);
        check("x without context", AdRules.isSkipLabel("×", false), false);
        check("bare 5s is not skip", AdRules.isSkipLabel("5s", false), false);
        check("long ad countdown", AdRules.isSkipLabel("跳过 15 秒广告", false), true);
        check("split 跳 过", AdRules.joinChildren(Arrays.asList("跳", "过")).equals("跳过"), true);
        check("split 35 | 跳过", AdRules.joinChildren(Arrays.asList("35", " | ", "跳过")).equals("35|跳过"), true);
        check("ad view id", AdRules.hasAdMarker("com.xunmeng.pinduoduo:id/ad_container"), true);
        check("normal app id", AdRules.hasAdMarker("com.example:id/toolbar"), false);

        if (failed > 0) {
            System.out.println("=== " + failed + " failed ===");
            System.exit(1);
        }
        System.out.println("=== all ad rules passed ===");
    }
}
