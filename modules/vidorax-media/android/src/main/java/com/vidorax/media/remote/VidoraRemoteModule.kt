package com.vidorax.media.remote

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The `VidoraRemote` Expo module (P6: Remote control, Send to computer, Automation API); its contract is
 * modules/vidorax-media/src/VidoraRemote.types.ts. Kept apart from `VidoraMedia` so the remote features stay in
 * their own files.
 */
class VidoraRemoteModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private val statusListener: () -> Unit = {
    runCatching { sendEvent(ON_STATUS, RemoteControl.status(context).toJs()) }
  }

  override fun definition() = ModuleDefinition {
    Name("VidoraRemote")

    Events(ON_STATUS, ON_LINK_REQUEST)

    OnStartObserving(ON_STATUS) { RemoteControl.addListener(statusListener) }

    OnStopObserving(ON_STATUS) { RemoteControl.removeListener(statusListener) }

    // While JavaScript listens, every link from the Web UI, the extension, the CLI or another app comes here.
    OnStartObserving(ON_LINK_REQUEST) {
      RemoteControl.components(context).inbox.setListener { request -> sendEvent(ON_LINK_REQUEST, request.toJs()) }
    }

    OnStopObserving(ON_LINK_REQUEST) { RemoteControl.components(context).inbox.setListener(null) }

    OnDestroy {
      RemoteControl.removeListener(statusListener)
      runCatching { RemoteControl.components(context).inbox.setListener(null) }
    }

    AsyncFunction("getRemoteStatus") { RemoteControl.status(context).toJs() }

    AsyncFunction("startRemoteControl") { RemoteControl.start(context).toJs() }

    AsyncFunction("stopRemoteControl") {
      RemoteControl.stop(RemoteStopReason.USER)
      RemoteControl.status(context).toJs()
    }

    AsyncFunction("newRemotePin") { RemoteControl.newPin(context).toJs() }

    AsyncFunction("forgetRemoteClient") { id: String ->
      RemoteControl.components(context).auth.forget(id)
      RemoteControl.status(context).toJs()
    }

    AsyncFunction("forgetAllRemoteClients") {
      RemoteControl.components(context).auth.forgetAll()
      RemoteControl.status(context).toJs()
    }

    AsyncFunction("reportLinkResult") { requestId: String, outcome: String, title: String?, downloadId: String?, detail: String? ->
      RemoteControl.components(context).inbox.report(requestId, outcome, title, downloadId, detail)
    }

    AsyncFunction("sendToComputer") Coroutine { url: String?, title: String, downloadId: String? ->
      RemoteControl.sendToComputer(context, url, title, downloadId)?.toJs()
    }

    AsyncFunction("listSentToComputer") { RemoteControl.components(context).sent.list().map { it.toJs() } }

    AsyncFunction("removeSentToComputer") { id: String -> RemoteControl.components(context).sent.remove(id) }

    AsyncFunction("clearSentToComputer") { RemoteControl.components(context).sent.clear() }

    AsyncFunction("getAllowOtherApps") { AutomationSettings.allowed(context) }

    AsyncFunction("setAllowOtherApps") { allowed: Boolean -> AutomationSettings.setAllowed(context, allowed) }
  }

  private companion object {
    const val ON_STATUS = "onRemoteStatus"
    const val ON_LINK_REQUEST = "onLinkRequest"
  }
}

internal fun RemoteControl.Status.toJs(): Map<String, Any?> = mapOf(
  "running" to running,
  "url" to url,
  "address" to address,
  "port" to port,
  "pin" to pin,
  "lockedUntil" to lockedUntil?.toDouble(),
  "pinWithdrawn" to pinWithdrawn,
  "stopReason" to stopReason?.wire,
  "idleStopsAt" to idleStopsAt?.toDouble(),
  "clients" to clients.map {
    mapOf("id" to it.id, "name" to it.name, "createdAt" to it.createdAt.toDouble(), "lastSeenAt" to it.lastSeenAt.toDouble())
  },
)

internal fun LinkRequest.toJs(): Map<String, Any?> = mapOf(
  "requestId" to requestId,
  "url" to url,
  "source" to source.wire,
  "createdAt" to createdAt.toDouble(),
)

internal fun SentItem.toJs(): Map<String, Any?> = mapOf(
  "id" to id,
  "title" to title,
  "url" to url,
  "hasFile" to (libraryItemId != null),
  "sizeBytes" to sizeBytes?.toDouble(),
  "sentAt" to sentAt.toDouble(),
)
