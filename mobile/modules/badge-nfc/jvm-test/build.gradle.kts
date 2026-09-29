// Runs the NFC tag logic (Type4Tag.kt, plain Kotlin) on the JVM, without the Android SDK:
//   gradle test -p mobile/modules/badge-nfc/jvm-test
plugins { kotlin("jvm") version "2.0.21" }
repositories { mavenCentral() }
dependencies { testImplementation(kotlin("test")) }
sourceSets { main { kotlin.srcDir("../android/src/main/java").apply { kotlin.include("**/Type4Tag.kt") } } }
tasks.test { useJUnitPlatform(); testLogging { events("passed", "failed") } }
