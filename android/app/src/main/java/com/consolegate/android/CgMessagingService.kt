package com.consolegate.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives push notifications for ConsoleGate events (PLAY_BEYOND_DOWNTIME,
 * AGENT_OFFLINE, CLOCK_TAMPER_SUSPECTED, MORE_TIME_REQUESTED, …) so a parent is
 * alerted even when the app is backgrounded / off the LAN. The Hub dispatches via
 * FCM (or self-hosted ntfy) — see docs/implement/03-hub.md §3.7.
 */
class CgMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.data["title"] ?: message.notification?.title ?: "ConsoleGate"
        val body = message.data["body"] ?: message.notification?.body ?: ""
        notify(title, body)
    }

    override fun onNewToken(token: String) {
        // Re-register the refreshed FCM token with the Hub so pushes keep arriving.
        val ep = Prefs.cachedEndpoint(this) ?: return
        runCatching { HubApi(com.consolegate.shared.Endpoint(ep.first, ep.second, com.consolegate.shared.Endpoint.Source.CACHE)).registerPushToken(token) }
    }

    private fun notify(title: String, body: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "consolegate-events"
        nm.createNotificationChannel(
            NotificationChannel(channelId, "ConsoleGate", NotificationManager.IMPORTANCE_HIGH)
        )
        val n = NotificationCompat.Builder(this, channelId)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .build()
        nm.notify(body.hashCode(), n)
    }
}
