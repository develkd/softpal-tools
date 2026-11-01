import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Reine Kotlin/JVM-Bibliothek ohne Android-Abhängigkeiten:
// Termin-Erkennung aus OCR-Text, auf jeder JVM testbar.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation(libs.junit)
}
