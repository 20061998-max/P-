import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProps = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun propOrDefault(key: String, fallback: String): String =
    localProps.getProperty(key) ?: System.getenv(key) ?: fallback

android {
    namespace = "com.telacast.mirror"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.telacast.mirror"
        minSdk = 24
        targetSdk = 35
        versionCode = 2
        versionName = "1.1.0"

        buildConfigField("String", "SUPABASE_URL", "\"${propOrDefault("SUPABASE_URL", "https://seu-projeto.supabase.co")}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${propOrDefault("SUPABASE_ANON_KEY", "")}\"")
        buildConfigField("String", "API_BASE_URL", "\"${propOrDefault("API_BASE_URL", "https://jogos-do-mengao.onrender.com")}\"")
        buildConfigField("String", "LICENSE_PUBLIC_KEY", "\"${propOrDefault("LICENSE_PUBLIC_KEY", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkVVaVo/Pjsv4PvoeZIJvUnQlzg0WmSuKZsnR/i10u2+/fF0QraX4VWIrCxsVLWi9hAujF9DEXuJIcNUTo97FrA==")}\"")
        buildConfigField("String", "ADMIN_WHATSAPP", "\"${propOrDefault("ADMIN_WHATSAPP", "5548998091948")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
