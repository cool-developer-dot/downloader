package com.anonymous.vidorax

import android.app.Application
import android.content.res.Configuration

import androidx.appcompat.app.AppCompatDelegate
import com.vidorax.web.AppNightMode

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(com.anonymous.vidorax.mediadetection.MediaDetectionPackage())
          add(com.anonymous.vidorax.player.PlayerNativePackage())
          add(com.anonymous.vidorax.intent.IntentNativePackage())
          add(com.anonymous.vidorax.fileactions.FileActionsNativePackage())
          add(com.anonymous.vidorax.mediaexport.MediaExportNativePackage())
          add(com.anonymous.vidorax.notifications.DownloadNotificationsNativePackage())
        }
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Settings → Theme applies from the first activity frame (the launch screen on Android 8–11, the window background
    // everywhere), before JavaScript runs; Android 12+ also gets it for its system splash (AppNightMode).
    when (AppNightMode.recorded(this)) {
      AppNightMode.LIGHT -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
      AppNightMode.DARK -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)
      AppNightMode.SYSTEM -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)
    }
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
