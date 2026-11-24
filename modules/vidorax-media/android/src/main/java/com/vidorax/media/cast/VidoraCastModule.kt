package com.vidorax.media.cast

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The `VidoraCast` Expo module (P13 #667 Chromecast); its contract is modules/vidorax-media/src/VidoraCast.types.ts.
 * Kept apart from `VidoraMedia` and Faran's `VidoraPlayer` so casting stays in its own files. Every call runs on the
 * main thread, as the Cast SDK and MediaRouter require.
 */
class VidoraCastModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private var controller: CastController? = null

  private val events = object : CastEvents {
    override fun devices(devices: List<Map<String, Any?>>) = send(ON_DEVICES, mapOf("devices" to devices))

    override fun connected(deviceName: String) = send(ON_CONNECTED, mapOf("deviceName" to deviceName))

    override fun disconnected(reason: String, positionMs: Long?, finished: Boolean) =
      send(ON_DISCONNECTED, mapOf("reason" to reason, "positionMs" to positionMs?.toDouble(), "finished" to finished))

    override fun position(positionMs: Long, durationMs: Long?) =
      send(ON_POSITION, mapOf("positionMs" to positionMs.toDouble(), "durationMs" to durationMs?.toDouble()))

    override fun state(state: String, positionMs: Long?, durationMs: Long?, volume: Double?) = send(
      ON_STATE,
      mapOf(
        "state" to state,
        "positionMs" to positionMs?.toDouble(),
        "durationMs" to durationMs?.toDouble(),
        "volume" to volume,
      ),
    )

    override fun error(code: String, message: String) = send(ON_ERROR, mapOf("code" to code, "message" to message))
  }

  private fun send(name: String, body: Map<String, Any?>) {
    runCatching { sendEvent(name, body) }
  }

  private fun cast(): CastController = controller ?: CastController(context, events).also { controller = it }

  private fun releaseController() {
    val running = controller ?: return
    controller = null
    val main = android.os.Handler(android.os.Looper.getMainLooper())
    if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) running.release() else main.post { running.release() }
  }

  override fun definition() = ModuleDefinition {
    Name("VidoraCast")

    Events(ON_DEVICES, ON_CONNECTED, ON_DISCONNECTED, ON_POSITION, ON_STATE, ON_ERROR)

    // The app is destroyed (its activity, or its JavaScript runtime): the cast ends and the server stops.
    OnActivityDestroys { releaseController() }

    OnDestroy { releaseController() }

    AsyncFunction("isCastAvailable") { cast().isAvailable() }.runOnQueue(Queues.MAIN)

    AsyncFunction("startCastDiscovery") { cast().startDiscovery() }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopCastDiscovery") { controller?.stopDiscovery() ?: Unit }.runOnQueue(Queues.MAIN)

    AsyncFunction("getCastDevices") { cast().devices() }.runOnQueue(Queues.MAIN)

    AsyncFunction("connectCastDevice") { deviceId: String -> cast().connect(deviceId) }.runOnQueue(Queues.MAIN)

    AsyncFunction("castLoad") { request: CastLoadRecord -> cast().load(request) }.runOnQueue(Queues.MAIN)

    AsyncFunction("castPlay") { cast().play() }.runOnQueue(Queues.MAIN)

    AsyncFunction("castPause") { cast().pause() }.runOnQueue(Queues.MAIN)

    AsyncFunction("castSeek") { positionMs: Double -> cast().seek(positionMs) }.runOnQueue(Queues.MAIN)

    AsyncFunction("castSetVolume") { volume: Double -> cast().setVolume(volume) }.runOnQueue(Queues.MAIN)

    AsyncFunction("castStop") { controller?.stop() ?: Unit }.runOnQueue(Queues.MAIN)

    AsyncFunction("getCastStatus") { cast().status() }.runOnQueue(Queues.MAIN)
  }

  private companion object {
    const val ON_DEVICES = "onCastDevices"
    const val ON_CONNECTED = "onCastConnected"
    const val ON_DISCONNECTED = "onCastDisconnected"
    const val ON_POSITION = "onCastPosition"
    const val ON_STATE = "onCastState"
    const val ON_ERROR = "onCastError"
  }
}
