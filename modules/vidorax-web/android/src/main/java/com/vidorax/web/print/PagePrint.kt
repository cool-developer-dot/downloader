package com.vidorax.web.print

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView

/**
 * B17 #176 / #177 — Print and Save as PDF: the page through Android's print system (the dialog offers printers and
 * "Save as PDF"). No permission; the system's print spooler writes the PDF where the user picks.
 */
internal object PagePrint {
  /** "VidoraX – <title>" (or the host), one line, at most 100 characters: the job and the PDF's suggested name. */
  fun jobName(title: String?, url: String?): String {
    val clean = title?.replace(Regex("[\\r\\n\\t]+"), " ")?.replace(Regex("[\\\\/:*?\"<>|]"), " ")?.trim().orEmpty()
    val host = try {
      Uri.parse(url ?: "").host.orEmpty()
    } catch (_: Exception) {
      ""
    }
    val name = clean.ifBlank { host }.ifBlank { "page" }
    return "VidoraX - $name".take(100).trim()
  }

  fun print(activity: Activity, webView: WebView, jobName: String): Boolean {
    val manager = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager ?: return false
    return try {
      manager.print(jobName, webView.createPrintDocumentAdapter(jobName), PrintAttributes.Builder().build())
      true
    } catch (_: RuntimeException) {
      false
    }
  }
}
