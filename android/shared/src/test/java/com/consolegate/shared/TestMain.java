package com.consolegate.shared;

/** Runs the shared-module unit suite with a plain JDK (no JUnit/Gradle). */
public final class TestMain {
  public static void main(String[] args) {
    JsonTest.run();
    DiscoveryTest.run();
    ModelsTest.run();
    System.out.println();
    System.out.println("android/shared: " + TestHarness.run + " checks, " + TestHarness.failed + " failed");
    System.exit(TestHarness.failed == 0 ? 0 : 1);
  }
}
