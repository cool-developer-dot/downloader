package com.vidorax.web.scanner

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * B22 #30 — scans a QR code with the Google code scanner (Google Play services shows its own camera screen; VidoraX
 * asks for no CAMERA permission and never sees the camera). Answers { status, text }: `scanned` with the raw text,
 * `cancelled`, or `unavailable` (no Play services, or its scanner module can't be installed).
 */
internal object QrScanner {
  fun isAvailable(context: Context): Boolean =
    GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

  fun scan(context: Context, done: (Map<String, Any?>) -> Unit) {
    if (!isAvailable(context)) {
      done(result("unavailable"))
      return
    }
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    try {
      GmsBarcodeScanning.getClient(context, options).startScan()
        .addOnSuccessListener { barcode -> done(result("scanned", barcode.rawValue ?: "")) }
        .addOnCanceledListener { done(result("cancelled")) }
        .addOnFailureListener { done(result("unavailable")) }
    } catch (e: RuntimeException) {
      done(result("unavailable"))
    }
  }

  /** At most 4,096 characters of text go to JS. */
  fun result(status: String, text: String? = null): Map<String, Any?> =
    mapOf("status" to status, "text" to text?.take(4096))
}
