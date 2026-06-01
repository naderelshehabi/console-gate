package com.consolegate.android

import com.consolegate.shared.Endpoint
import com.consolegate.shared.HubModels
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * Thin REST + WebSocket client for the Hub. Response parsing is delegated to the
 * host-tested [HubModels] in the shared module, so this layer is just transport.
 */
class HubApi(private val endpoint: Endpoint, private val http: OkHttpClient = OkHttpClient()) {

    private val json = "application/json".toMediaType()
    private var deviceToken: String? = null
    private var pinSession: String? = null

    private fun req(method: String, path: String, body: String?, withPin: Boolean): Request {
        val b = Request.Builder().url("${endpoint.baseUrl()}$path")
        deviceToken?.let { b.header("Authorization", "Bearer $it") }
        if (withPin) pinSession?.let { b.header("X-Pin-Session", it) }
        if (body != null) b.method(method, body.toRequestBody(json)) else b.method(method, null)
        return b.build()
    }

    private fun call(r: Request): Pair<Int, String> {
        http.newCall(r).execute().use { resp: Response ->
            return resp.code to (resp.body?.string() ?: "")
        }
    }

    /** Set the parent PIN -> obtain a web device token + PIN session. */
    fun login(pin: String): Boolean {
        val (code, bodyStr) = call(req("POST", "/web/login", "{\"pin\":\"$pin\"}", false))
        if (code != 200) return false
        val login = HubModels.parseLogin(bodyStr) ?: return false
        deviceToken = login.deviceToken
        pinSession = login.pinSession
        return true
    }

    fun isAuthed(): Boolean = deviceToken != null

    fun setupNeeded(): Boolean {
        val (_, body) = call(req("GET", "/setup", null, false))
        return body.contains("\"pinSet\":false")
    }

    fun consoles(): List<HubModels.ConsoleView> {
        val (code, body) = call(req("GET", "/consoles", null, false))
        return if (code == 200) HubModels.parseConsoles(body) else emptyList()
    }

    /** Privileged action: lock/unlock/pause/resume. */
    fun action(consoleId: String, action: String): Boolean =
        call(req("POST", "/consoles/$consoleId/$action", "{}", true)).first == 200

    fun grant(consoleId: String, minutes: Int): Boolean =
        call(req("POST", "/consoles/$consoleId/grant", "{\"minutes\":$minutes}", true)).first == 200

    fun approveRequest(requestId: String): Boolean =
        call(req("POST", "/requests/$requestId/approve", "{}", true)).first == 200

    fun registerPushToken(token: String) {
        // The device must already be paired; push token is attached on the Hub.
        // (Endpoint: handled at pairing; here we re-send on FCM token refresh.)
        runCatching { call(req("POST", "/web/login", "{\"pushToken\":\"$token\"}", false)) }
    }

    /** Open the live stream; `onKind` receives the message kind ("event"/"state"). */
    fun openStream(onKind: (String) -> Unit): WebSocket {
        val token = deviceToken ?: ""
        val wsUrl = "${endpoint.baseUrl()}/stream?token=$token"
            .replaceFirst("http://", "ws://")
            .replaceFirst("https://", "wss://")
        val request = Request.Builder().url(wsUrl).build()
        return http.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                onKind(HubModels.streamMessageKind(text))
            }
        })
    }
}
