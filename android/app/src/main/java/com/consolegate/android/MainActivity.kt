package com.consolegate.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.consolegate.shared.Endpoint
import com.consolegate.shared.HubModels
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Minimal Compose UI: discover the Hub, log in with the parent PIN, then show a
 * live dashboard with quick actions. Parsing/discovery decisions come from the
 * host-tested shared module; this file is presentation + wiring.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val discovery = DiscoveryManager(
            context = this,
            cachedHostPort = { Prefs.cachedEndpoint(this) },
            manualHostPort = { Prefs.manualEndpoint(this) },
        )
        setContent { App(discovery) }
    }
}

private sealed interface UiState {
    data object Discovering : UiState
    data class NeedManual(val msg: String) : UiState
    data class Login(val api: HubApi) : UiState
    data class Dashboard(val api: HubApi, val consoles: List<HubModels.ConsoleView>) : UiState
}

@Composable
private fun App(discovery: DiscoveryManager) {
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<UiState>(UiState.Discovering) }

    suspend fun connect() {
        state = UiState.Discovering
        val ep: Endpoint? = withContext(Dispatchers.IO) { discovery.discover() }
        state = if (ep == null) {
            UiState.NeedManual("Couldn't find the Hub. Make sure your phone is on the same Wi-Fi (not a guest network), or enter its address.")
        } else {
            UiState.Login(HubApi(ep))
        }
    }

    LaunchedEffect(Unit) { connect() }

    MaterialTheme(colorScheme = darkColorScheme()) {
        Surface {
            when (val s = state) {
                is UiState.Discovering -> Centered { CircularProgressIndicator(); Spacer(Modifier.height(12.dp)); Text("Finding ConsoleGate…") }
                is UiState.NeedManual -> Column(Modifier.padding(24.dp)) {
                    Text(s.msg)
                    Button(onClick = { scope.launch { connect() } }, modifier = Modifier.padding(top = 16.dp)) { Text("Retry") }
                }
                is UiState.Login -> LoginScreen(s.api) { consoles ->
                    state = UiState.Dashboard(s.api, consoles)
                }
                is UiState.Dashboard -> DashboardScreen(s.api, s.consoles) { refreshed ->
                    state = UiState.Dashboard(s.api, refreshed)
                }
            }
        }
    }
}

@Composable
private fun Centered(content: @Composable ColumnScope.() -> Unit) =
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, content = content)

@Composable
private fun LoginScreen(api: HubApi, onLoggedIn: (List<HubModels.ConsoleView>) -> Unit) {
    val scope = rememberCoroutineScope()
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.padding(24.dp)) {
        Text("Parent login", style = MaterialTheme.typography.headlineSmall)
        OutlinedTextField(value = pin, onValueChange = { pin = it }, label = { Text("PIN") }, modifier = Modifier.padding(top = 12.dp))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            modifier = Modifier.padding(top = 12.dp),
            onClick = {
                scope.launch {
                    val ok = withContext(Dispatchers.IO) { api.login(pin) }
                    if (ok) onLoggedIn(withContext(Dispatchers.IO) { api.consoles() })
                    else error = "Wrong PIN"
                }
            },
        ) { Text("Unlock") }
    }
}

@Composable
private fun DashboardScreen(api: HubApi, consoles: List<HubModels.ConsoleView>, onRefresh: (List<HubModels.ConsoleView>) -> Unit) {
    val scope = rememberCoroutineScope()
    fun refresh() = scope.launch { onRefresh(withContext(Dispatchers.IO) { api.consoles() }) }

    // Live updates: refresh on any stream message.
    DisposableEffect(Unit) {
        val ws = api.openStream { refresh() }
        onDispose { ws.cancel() }
    }

    LazyColumn(Modifier.fillMaxSize().padding(16.dp)) {
        items(consoles) { c ->
            ElevatedCard(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("${c.name}  ·  ${c.state}", style = MaterialTheme.typography.titleMedium)
                    Text("${c.reason} — ${c.minutesUsed}/${c.quotaTotalMin} min, ${c.quotaRemainingMin} left")
                    Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { scope.launch { withContext(Dispatchers.IO) { api.action(c.id, "lock") }; refresh() } }) { Text("Lock") }
                        TextButton(onClick = { scope.launch { withContext(Dispatchers.IO) { api.action(c.id, "unlock") }; refresh() } }) { Text("Unlock") }
                        TextButton(onClick = { scope.launch { withContext(Dispatchers.IO) { api.grant(c.id, 15) }; refresh() } }) { Text("+15 min") }
                    }
                }
            }
        }
    }
}
