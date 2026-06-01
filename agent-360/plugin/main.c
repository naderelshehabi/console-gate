/*
 * main.c — ConsoleGate Xbox 360 agent (Dashlaunch plugin).
 *
 * HARDWARE LAYER: builds with the Xbox 360 XDK (_XBOX), loaded via launch.ini
 * [Plugins]. All policy/decision logic is delegated to agent-core (host-tested);
 * this file is the thin glue: a resident background thread that polls the Hub,
 * overlays graduated warnings during gameplay, and force-closes the running title
 * at downtime (XLaunchNewImage). See docs/implement/04-console-xbox360.md.
 *
 * Why a plugin: a Dashlaunch plugin stays resident and runs while a game is
 * running (confirmed: docs/implement/01-research-findings.md §A1), which is what
 * makes mid-game warnings + force-close possible on the 360 (unlike the Wii).
 */
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#include "cg_proto.h"
#include "cg_agent.h"
#include "cg_enforce.h"
#include "net.h"

#define AGENT_VERSION "x360-0.1.0"
#define DISCOVERY_PORT 8099
#define POLL_MS_NORMAL 25000
#define POLL_MS_URGENT 7000

/* snprintf shim: the XDK CRT exposes _snprintf, host gcc exposes snprintf. */
#ifdef _XBOX
#define _snprintf_or_snprintf _snprintf
#else
#define _snprintf_or_snprintf snprintf
#endif

/* ---- platform hooks (implemented per-target below) ---------------------- */
static long long p360_mono_ms(void);
static long long p360_local_utc_ms(void);
static int p360_in_game(void);
static void p360_overlay_warn(long minutes_left);
static void p360_overlay_grace(long seconds_left);
static void p360_overlay_nag(const char *reason);
static void p360_show_lock(const char *reason);
static void p360_force_close_to_dash(void);
static void p360_sleep_ms(int ms);
static int p360_load_token(char *token, int len, char *host, int hostlen, int *port, long long *high_water);
static void p360_save_high_water(long long high_water);

/* ---- agent state -------------------------------------------------------- */
typedef struct {
  char token[64];
  char host[24];
  int port;
  long long high_water;
  cg_warn_state warns;
  long long mono_last;
  long long carry_ms;
  long prev_remaining;
} agent_ctx;

static int hub(agent_ctx *a, const char *method, const char *path, const char *body,
               char *resp, int resp_len) {
  return cg360_request(a->host, a->port, method, path, a->token, NULL, body, resp, resp_len);
}

static void post_event(agent_ctx *a, const char *type) {
  char body[96];
  _snprintf_or_snprintf(body, sizeof(body), "[{\"type\":\"%s\"}]", type);
  char resp[128];
  hub(a, "POST", "/api/v1/agent/events", body, resp, sizeof(resp));
}

static void ack_commands(agent_ctx *a, const cg_poll_response *pr) {
  for (int i = 0; i < pr->command_count; i++) {
    char body[96], resp[96];
    _snprintf_or_snprintf(body, sizeof(body), "{\"commandId\":\"%s\"}", pr->commands[i].id);
    hub(a, "POST", "/api/v1/agent/command/ack", body, resp, sizeof(resp));
  }
}

/* One poll + enforcement tick. Returns the next poll interval in ms. */
static int tick(agent_ctx *a) {
  int in_game = p360_in_game();

  /* Count play minutes only while a game is running (clock-independent). */
  long delta;
  if (in_game) {
    delta = cg_minutes_delta(p360_mono_ms(), &a->mono_last, &a->carry_ms);
  } else {
    a->mono_last = p360_mono_ms();
    a->carry_ms = 0;
    delta = 0;
  }

  cg_poll_request req;
  req.minutes_used_delta = delta;
  req.local_utc_guess = p360_local_utc_ms();
  req.state = NULL;
  req.agent_version = AGENT_VERSION;
  char body[256];
  if (cg_proto_build_poll(&req, body, sizeof(body)) < 0) return POLL_MS_NORMAL;

  char resp[2048];
  int status = hub(a, "POST", "/api/v1/agent/poll", body, resp, sizeof(resp));
  if (status != 200) {
    /* Hub unreachable: hold last cached behaviour; a production build fails closed
     * after the grace window via cg_agent_hub_grace_expired(). */
    return POLL_MS_NORMAL;
  }

  cg_poll_response pr;
  if (!cg_proto_parse_poll(resp, &pr)) return POLL_MS_NORMAL;
  cg_agent_update_high_water(&a->high_water, pr.authoritative_utc_ms);
  p360_save_high_water(a->high_water);
  ack_commands(a, &pr);

  /* Re-arm warnings when comfortably far from a boundary or the budget grew. */
  long max_thr = 0;
  for (int i = 0; i < pr.warn_count; i++) if (pr.warn_thresholds[i] > max_thr) max_thr = pr.warn_thresholds[i];
  if (pr.secs_to_boundary > max_thr * 60 || pr.quota_remaining_min > a->prev_remaining) {
    cg_warn_reset(&a->warns);
  }
  a->prev_remaining = pr.quota_remaining_min;
  if (a->warns.count == 0 && pr.warn_count > 0) cg_warn_init(&a->warns, pr.warn_thresholds, pr.warn_count);

  cg_action action = cg_enforce_action(pr.state, pr.enforcement, in_game);
  switch (action) {
    case CG_ACT_WARN: {
      long which = cg_warn_check(&a->warns, pr.secs_to_boundary);
      if (which >= 0) p360_overlay_warn(which);
      return POLL_MS_URGENT;
    }
    case CG_ACT_GRACE:
      p360_overlay_grace(pr.secs_to_boundary);
      return POLL_MS_URGENT;
    case CG_ACT_FORCE_CLOSE:
      post_event(a, "PLAY_INTERRUPTED");
      p360_force_close_to_dash();
      return POLL_MS_URGENT;
    case CG_ACT_NAG:
      post_event(a, "PLAY_BEYOND_DOWNTIME");
      p360_overlay_nag(pr.reason);
      return POLL_MS_URGENT;
    case CG_ACT_LOCK:
      p360_show_lock(pr.reason);
      return POLL_MS_URGENT;
    case CG_ACT_NONE:
    default:
      return POLL_MS_NORMAL;
  }
}

/* Background thread body: pair-once must already be done via cg_dash; here we
 * load the stored token and enforce forever. */
static void agent_loop(void) {
  agent_ctx a;
  memset(&a, 0, sizeof(a));
  a.port = 8088;
  a.mono_last = p360_mono_ms();
  cg360_net_init();

  if (!p360_load_token(a.token, sizeof(a.token), a.host, sizeof(a.host), &a.port, &a.high_water)) {
    /* Not paired yet: discover the Hub so cg_dash can pair, then idle-poll. */
    int port = cg360_discover_hub(DISCOVERY_PORT, a.host, sizeof(a.host));
    if (port > 0) a.port = port;
  }

  for (;;) {
    int next = (a.token[0] != 0) ? tick(&a) : POLL_MS_NORMAL;
    p360_sleep_ms(next);
  }
}

/* ---- plugin entry ------------------------------------------------------- */
#ifdef _XBOX
#include <xtl.h>

static DWORD WINAPI cg_thread(LPVOID arg) {
  (void)arg;
  agent_loop();
  return 0;
}

/* Dashlaunch loads the plugin and calls its entry; we spin up the resident
 * enforcement thread and return so the dashboard/game continues to load. */
VOID DllMain(DWORD reason) {
  if (reason == DLL_PROCESS_ATTACH) {
    HANDLE h;
    DWORD tid;
    ExCreateThread(&h, 0, &tid, NULL, cg_thread, NULL, 2 /*system thread*/);
    if (h) ExSetThreadProcessor ? (void)0 : (void)0; /* run on a free core (build-specific) */
  }
}
#else
/* Host compile-check reference so the orchestration loop is type-checked without
 * the XDK DllMain entry. Never called; exists only to exercise `agent_loop`. */
void cg360_agent_loop_ref(void);
void cg360_agent_loop_ref(void) { agent_loop(); }
#endif

/* ---- platform hook implementations -------------------------------------- */
#ifdef _XBOX
#include <xtl.h>
#include <xboxmath.h>

static long long p360_mono_ms(void) {
  LARGE_INTEGER c, f;
  QueryPerformanceCounter(&c);
  QueryPerformanceFrequency(&f);
  return (long long)(c.QuadPart * 1000 / f.QuadPart);
}
static long long p360_local_utc_ms(void) {
  /* 360 has no battery RTC; this is the (untrusted) system clock, corroborated
   * by the Hub's authoritative time. */
  return (long long)time(NULL) * 1000;
}
static int p360_in_game(void) {
  DWORD title = XamGetCurrentTitleId();
  /* Dashboard/NXE and our own agent are "not in game". 0xFFFE07D1 = NXE. */
  return (title != 0 && title != 0xFFFE07D1) ? 1 : 0;
}
static void p360_overlay_warn(long minutes_left) {
  WCHAR msg[64];
  swprintf(msg, L"ConsoleGate: %ld minutes left", minutes_left);
  XNotifyQueueUI(XNOTIFYUI_TYPE_GENERIC, 0, XNOTIFY_SYSTEM, msg, NULL);
}
static void p360_overlay_grace(long seconds_left) {
  WCHAR msg[64];
  swprintf(msg, L"ConsoleGate: save now! Locking in %ld s", seconds_left);
  XNotifyQueueUI(XNOTIFYUI_TYPE_GENERIC, 0, XNOTIFY_SYSTEM, msg, NULL);
}
static void p360_overlay_nag(const char *reason) {
  (void)reason;
  XNotifyQueueUI(XNOTIFYUI_TYPE_GENERIC, 0, XNOTIFY_SYSTEM, L"ConsoleGate: past your limit", NULL);
}
static void p360_force_close_to_dash(void) {
  /* Terminate the running title and return to the dashboard (the agent home). */
  XLaunchNewImage("\\Device\\Harddisk0\\Partition1\\cg_dash\\default.xex", 0);
}
static void p360_show_lock(const char *reason) {
  (void)reason; /* cg_dash renders the full lock screen; the plugin just ensures
                 * we are at the dashboard. */
}
static void p360_sleep_ms(int ms) { Sleep(ms); }
static int p360_load_token(char *token, int len, char *host, int hostlen, int *port, long long *hw) {
  FILE *f = fopen("Hdd:\\cg_agent\\state.cfg", "r");
  if (!f) return 0;
  /* token\nhost\nport\nhighwater */
  if (!fgets(token, len, f)) { fclose(f); return 0; }
  token[strcspn(token, "\r\n")] = 0;
  if (fgets(host, hostlen, f)) host[strcspn(host, "\r\n")] = 0;
  char line[32];
  if (fgets(line, sizeof(line), f)) *port = atoi(line);
  if (fgets(line, sizeof(line), f)) *hw = _atoi64(line);
  fclose(f);
  return token[0] != 0;
}
static void p360_save_high_water(long long hw) {
  /* Production: rewrite only the high-water line; omitted for brevity. */
  (void)hw;
}
#else
/* Host stubs (this file is not host-built; present for clarity only). */
static long long p360_mono_ms(void) { return 0; }
static long long p360_local_utc_ms(void) { return 0; }
static int p360_in_game(void) { return 0; }
static void p360_overlay_warn(long m) { (void)m; }
static void p360_overlay_grace(long s) { (void)s; }
static void p360_overlay_nag(const char *r) { (void)r; }
static void p360_show_lock(const char *r) { (void)r; }
static void p360_force_close_to_dash(void) {}
static void p360_sleep_ms(int ms) { (void)ms; }
static int p360_load_token(char *t, int l, char *h, int hl, int *p, long long *hw) {
  (void)t; (void)l; (void)h; (void)hl; (void)p; (void)hw; return 0;
}
static void p360_save_high_water(long long hw) { (void)hw; }
#endif
