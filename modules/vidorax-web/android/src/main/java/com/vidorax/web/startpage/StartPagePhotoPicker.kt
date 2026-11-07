package com.vidorax.web.startpage

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.ext.SdkExtensions
import android.provider.MediaStore
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

/**
 * B21 #245 — choosing the start page's photo without any storage or camera permission: Android's Photo Picker
 * (`MediaStore.ACTION_PICK_IMAGES`, Android 13+, and Android 11–12 with the photo picker's SDK extension); on other
 * versions the system document picker (`ACTION_OPEN_DOCUMENT`, images only), which needs no permission either. The
 * app only gets the one picked image, for reading once.
 */
object PhotoPicker {
  /** Whether the system Photo Picker exists (the same rule as androidx's PickVisualMedia). */
  fun hasSystemPicker(sdkInt: Int, rExtension: Int): Boolean =
    sdkInt >= 33 || (sdkInt >= 30 && rExtension >= 2)

  fun intent(sdkInt: Int = Build.VERSION.SDK_INT, rExtension: Int = rExtensionVersion()): Intent =
    if (hasSystemPicker(sdkInt, rExtension)) {
      Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*")
    } else {
      Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*")
    }

  private fun rExtensionVersion(): Int =
    if (Build.VERSION.SDK_INT >= 30) SdkExtensions.getExtensionVersion(Build.VERSION_CODES.R) else 0
}

/** Starts the picker and gives back the picked image, or null when the user cancelled. */
internal class StartPagePhotoContract : AppContextActivityResultContract<StartPagePhotoContract.Request, Uri?> {
  class Request : Serializable

  override fun createIntent(context: Context, input: Request): Intent = PhotoPicker.intent()

  override fun parseResult(input: Request, resultCode: Int, intent: Intent?): Uri? =
    if (resultCode == Activity.RESULT_OK) intent?.data else null
}
