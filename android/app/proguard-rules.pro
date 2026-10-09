# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# WebView JavaScript bridges: react-native-webview's `window.ReactNativeWebView.postMessage` (page -> app messages,
# which media detection depends on) is only ever called from JavaScript, so R8 would otherwise drop or rename it.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# Legacy React Native modules in this app (file actions, notifications, media export, volume, cookies, intents) are
# invoked through @ReactMethod reflection by name.
-keep class com.anonymous.vidorax.** extends com.facebook.react.bridge.BaseJavaModule { *; }

# Add any project specific keep options here:
