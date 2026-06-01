package com.consolegate.android

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted local storage for the cached Hub endpoint, an optional manually
 * entered endpoint, and the paired device token (Keystore-backed).
 */
object Prefs {
    private fun prefs(ctx: Context) = EncryptedSharedPreferences.create(
        ctx,
        "consolegate",
        MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun cachedEndpoint(ctx: Context): Pair<String, Int>? = read(ctx, "cache_host", "cache_port")
    fun setCachedEndpoint(ctx: Context, host: String, port: Int) = write(ctx, "cache_host", "cache_port", host, port)

    fun manualEndpoint(ctx: Context): Pair<String, Int>? = read(ctx, "manual_host", "manual_port")
    fun setManualEndpoint(ctx: Context, host: String, port: Int) = write(ctx, "manual_host", "manual_port", host, port)

    fun deviceToken(ctx: Context): String? = prefs(ctx).getString("device_token", null)
    fun setDeviceToken(ctx: Context, token: String) = prefs(ctx).edit().putString("device_token", token).apply()

    private fun read(ctx: Context, hk: String, pk: String): Pair<String, Int>? {
        val p = prefs(ctx)
        val host = p.getString(hk, null) ?: return null
        val port = p.getInt(pk, 0)
        return if (port > 0) host to port else null
    }

    private fun write(ctx: Context, hk: String, pk: String, host: String, port: Int) =
        prefs(ctx).edit().putString(hk, host).putInt(pk, port).apply()
}
