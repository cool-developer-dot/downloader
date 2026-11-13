package com.vidorax.web.window

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `VidoraWeb.openBrowserWindow`'s argument as Expo converts it; [BrowserWindowRequest.of] validates it. */
data class BrowserWindowRecord(
  @Field val windowId: String = "",
  @Field val url: String = "",
  @Field val title: String = "",
  @Field val profile: String = "",
  @Field val userAgent: String? = null,
  @Field val lockOnLeave: Boolean = false,
  @Field val rtl: Boolean = false,
  @Field val dark: Boolean = false,
  @Field val colors: Map<String, String> = emptyMap(),
  @Field val labels: Map<String, String> = emptyMap(),
) : Record {
  internal fun toRequest(): BrowserWindowRequest? =
    BrowserWindowRequest.of(windowId, url, title, profile, userAgent, lockOnLeave, rtl, dark, colors, labels)
}
