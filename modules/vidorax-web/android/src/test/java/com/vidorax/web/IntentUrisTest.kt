package com.vidorax.web

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IntentUrisTest {
  @Test
  fun acceptsOnlyIntentUris() {
    assertTrue(IntentUris.isIntentUri("intent://item/42#Intent;scheme=snssdk1233;package=com.zhiliaoapp.musically;end"))
    assertTrue(IntentUris.isIntentUri("  INTENT:#Intent;action=android.intent.action.VIEW;end"))
    assertFalse(IntentUris.isIntentUri("snssdk1233://item/42"))
    assertFalse(IntentUris.isIntentUri("https://example.com/intent:"))
    assertFalse(IntentUris.isIntentUri(""))
  }

  @Test
  fun blocksLocalAndScriptSchemes() {
    listOf("file", "content", "javascript", "data", "blob", "view-source", "FILE").forEach { scheme ->
      assertTrue(scheme, IntentUris.isBlockedScheme(scheme))
    }
    listOf("https", "market", "snssdk1233", null).forEach { scheme ->
      assertFalse(scheme.toString(), IntentUris.isBlockedScheme(scheme))
    }
  }

  @Test
  fun removesUriPermissionGrantsButKeepsOtherFlags() {
    val requested = Intent.FLAG_ACTIVITY_NEW_TASK or
      Intent.FLAG_GRANT_READ_URI_PERMISSION or
      Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
      Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
      Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
    assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK, IntentUris.withoutUriGrants(requested))
    assertEquals(0, IntentUris.withoutUriGrants(0))
  }
}
