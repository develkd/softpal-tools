import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Reine Kotlin/JVM-Bibliothek ohne Android-Abhängigkeiten:
// Kalorienbedarf, Übungen + Animations-Posen, Lebensmittel, positive Hinweise, KI-Fotoanalyse.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
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
    api(libs.kotlinx.serialization.json)
    implementation(libs.anthropic.java)
    testImplementation(libs.junit)
}
