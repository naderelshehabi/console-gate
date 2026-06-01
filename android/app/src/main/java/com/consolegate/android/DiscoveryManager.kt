package com.consolegate.android

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import com.consolegate.shared.DiscoveryCoordinator
import com.consolegate.shared.Endpoint
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Android binding for the host-tested [DiscoveryCoordinator]. Each source wraps a
 * platform mechanism; the *ordering/retry/validation policy* lives in the shared
 * module (unit-tested). See docs/implement/07-android-app.md §7.3.
 *
 * Layered: cached endpoint → mDNS (NsdManager) → UDP broadcast → manual IP.
 */
class DiscoveryManager(
    private val context: Context,
    private val cachedHostPort: () -> Pair<String, Int>?,
    private val manualHostPort: () -> Pair<String, Int>?,
    private val discoveryPort: Int = 8099,
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(1500, TimeUnit.MILLISECONDS)
        .readTimeout(1500, TimeUnit.MILLISECONDS)
        .build()

    /** Validator: a quick GET /hello that confirms a real Hub responds. */
    private val validator = DiscoveryCoordinator.Validator { e ->
        try {
            http.newCall(Request.Builder().url("${e.baseUrl()}/hello").build()).execute().use { resp ->
                resp.isSuccessful && (resp.body?.string()?.contains("hubId") == true)
            }
        } catch (t: Throwable) {
            false
        }
    }

    fun discover(): Endpoint? {
        val sources = listOf(
            cacheSource(),
            mdnsSource(),
            udpSource(),
            manualSource(),
        )
        return DiscoveryCoordinator(sources, validator, /* retriesPerLossySource = */ 3)
            .discover()
            .endpoint
    }

    private fun cacheSource() = object : DiscoveryCoordinator.Source {
        override fun find(): Endpoint? = cachedHostPort()?.let { (h, p) -> Endpoint(h, p, Endpoint.Source.CACHE) }
        override fun kind() = Endpoint.Source.CACHE
    }

    private fun manualSource() = object : DiscoveryCoordinator.Source {
        override fun find(): Endpoint? = manualHostPort()?.let { (h, p) -> Endpoint(h, p, Endpoint.Source.MANUAL) }
        override fun kind() = Endpoint.Source.MANUAL
    }

    /** UDP broadcast beacon — robust fallback when mDNS is filtered. */
    private fun udpSource() = object : DiscoveryCoordinator.Source {
        override fun find(): Endpoint? {
            val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val lock = wifi.createMulticastLock("consolegate-udp").apply { acquire() }
            try {
                DatagramSocket().use { sock ->
                    sock.broadcast = true
                    sock.soTimeout = 800
                    val probe = "CG_DISCOVER?v1".toByteArray()
                    sock.send(DatagramPacket(probe, probe.size, InetAddress.getByName("255.255.255.255"), discoveryPort))
                    val buf = ByteArray(512)
                    val reply = DatagramPacket(buf, buf.size)
                    sock.receive(reply)
                    val json = String(reply.data, 0, reply.length)
                    return Endpoint.fromDiscoveryReply(json, reply.address.hostAddress)
                }
            } catch (t: Throwable) {
                return null
            } finally {
                if (lock.isHeld) lock.release()
            }
        }
        override fun kind() = Endpoint.Source.UDP_BROADCAST
    }

    /** mDNS/DNS-SD via NsdManager. Resolves are serialized (one in flight) to
     *  avoid the documented "listener in use" failure; a MulticastLock is held. */
    private fun mdnsSource() = object : DiscoveryCoordinator.Source {
        override fun find(): Endpoint? {
            val nsd = context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
            val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val lock = wifi.createMulticastLock("consolegate-mdns").apply { acquire() }
            val latch = CountDownLatch(1)
            var found: Endpoint? = null

            val resolveListener = object : NsdManager.ResolveListener {
                override fun onServiceResolved(info: NsdServiceInfo) {
                    found = Endpoint(info.host.hostAddress, info.port, Endpoint.Source.MDNS)
                    latch.countDown()
                }
                override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) { latch.countDown() }
            }
            val discoveryListener = object : NsdManager.DiscoveryListener {
                override fun onServiceFound(info: NsdServiceInfo) {
                    // Serialize: resolve the first match, then stop.
                    nsd.resolveService(info, resolveListener)
                }
                override fun onServiceLost(info: NsdServiceInfo) {}
                override fun onDiscoveryStarted(serviceType: String) {}
                override fun onDiscoveryStopped(serviceType: String) {}
                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { latch.countDown() }
                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            }
            try {
                nsd.discoverServices("_consolegate._tcp", NsdManager.PROTOCOL_DNS_SD, discoveryListener)
                latch.await(2500, TimeUnit.MILLISECONDS)
                return found
            } catch (t: Throwable) {
                return null
            } finally {
                try { nsd.stopServiceDiscovery(discoveryListener) } catch (_: Throwable) {}
                if (lock.isHeld) lock.release()
            }
        }
        override fun kind() = Endpoint.Source.MDNS
    }
}
