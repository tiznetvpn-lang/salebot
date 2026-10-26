plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appVersionCode = (project.findProperty("tiznet.versionCode") as String).toInt()
val appVersionName = project.findProperty("tiznet.versionName") as String

android {
    namespace = "site.tiznet.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "site.tiznet.app"
        minSdk = 26
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersionName
        resourceConfigurations += listOf("fa", "en")
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file(project.findProperty("tiznet.storeFile") as String)
            storeType = "PKCS12"
            storePassword = project.findProperty("tiznet.storePassword") as String
            keyAlias = project.findProperty("tiznet.keyAlias") as String
            keyPassword = project.findProperty("tiznet.keyPassword") as String
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/DEPENDENCIES")
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        abortOnError = false
    }

    testOptions {
        unitTests.isIncludeAndroidResources = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // تست JVM تحلیل پیامک بانکی؛ در GitHub Actions قبل از ساخت APK اجرا می‌شود.
    testImplementation("junit:junit:4.13.2")
}
