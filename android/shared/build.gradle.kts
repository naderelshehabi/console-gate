// The shared module is a pure-JVM Java library — no Android dependency — so its
// logic (discovery coordination, JSON, Hub model parsing) unit-tests with a
// plain JDK and is reusable from the Android app.
plugins {
    `java-library`
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

// Tests use a hand-rolled harness (no JUnit dependency) runnable via the JDK:
//   javac -d build $(find src -name '*.java'); java -cp build com.consolegate.shared.TestMain
// (kept dependency-free so it runs without Gradle in CI). See android/README.md.
