package com.consolegate.shared;

import java.util.Objects;

/** Tiny dependency-free assert harness (no JUnit) so the shared module unit-tests
 * with a plain JDK. */
public final class TestHarness {
  public static int run = 0;
  public static int failed = 0;

  public static void check(boolean cond, String msg) {
    run++;
    if (!cond) {
      failed++;
      System.out.println("FAIL: " + msg);
    }
  }

  public static void eq(Object a, Object b, String msg) {
    run++;
    if (!Objects.equals(a, b)) {
      failed++;
      System.out.println("FAIL: " + msg + " (got " + a + ", expected " + b + ")");
    }
  }

  public static void eqi(long a, long b, String msg) {
    run++;
    if (a != b) {
      failed++;
      System.out.println("FAIL: " + msg + " (got " + a + ", expected " + b + ")");
    }
  }
}
