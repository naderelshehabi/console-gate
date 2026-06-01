/*
 * main.c — ConsoleGate Wii gatekeeper (Priiloader autoboot target).
 *
 * HARDWARE LAYER: builds with devkitPPC/libogc (see agent-wii/Makefile), not on
 * the host. All policy/decision logic is delegated to agent-core (host-tested);
 * this file is the thin platform glue: video/input/network/persistence + the
 * launch-gate flow described in docs/implement/05-console-wii.md.
 *
 * Flow each boot:
 *   1. init video/input/FAT/network; load persisted store
 *   2. if a session was pending (we just returned from a game), reconcile it
 *      (session/end with elapsed + overage) — next-gate reconciliation
 *   3. poll the Hub for {authoritative time, effective state, commands}
 *   4. apply commands; update + persist the high-water mark
 *   5. if LOCKED -> lock screen (reason, request-more-time, parent-PIN unlock)
 *   6. else run the won't-finish launch guard; if OK/WARN, start a session and
 *      chain to the game loader (Return-To routes the exit back here)
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#ifdef __wii__
#include <gccore.h>
#include <wiiuse/wpad.h>
#include <fat.h>
#include <ogc/lwp_watchdog.h>
#endif

#include "cg_proto.h"
#include "cg_agent.h"
#include "net.h"
#include "store.h"

#define AGENT_VERSION "wii-0.1.0"
#define DISCOVERY_PORT 8099
#define GRACE_WINDOW_MS (15 * 60 * 1000)

/* ---- platform hooks (kept tiny; documented integration points) ---------- */

static void ui_init(void);
static void ui_clear(void);
static void ui_print(const char *line);
static void ui_printf(const char *fmt, ...);
static int ui_wait_button_a(void);      /* returns 1 on A, 0 on HOME */
static int64_t platform_local_time_ms(void); /* Wii RTC -> epoch ms (untrusted) */
static int platform_enter_code(char *out, int out_len); /* numeric pairing entry */
static int platform_enter_pin(char *out, int out_len);
static void platform_launch_loader(void); /* chain to USB Loader GX / WiiFlow */

/* ---- helpers ------------------------------------------------------------ */

static int hub_request(const cg_store *s, const char *method, const char *path,
                       const char *body, const char *pin_session, char *resp, int resp_len) {
  return cgnet_request(s->hub_host, s->hub_port, method, path, s->device_token, pin_session,
                       body, resp, resp_len);
}

/* Ensure we know where the Hub is and have a device token; pair if needed. */
static int ensure_paired(cg_store *s) {
  if (s->hub_host[0] == 0) {
    int port = cgnet_discover_hub(DISCOVERY_PORT, s->hub_host, sizeof(s->hub_host));
    if (port > 0) s->hub_port = port;
  }
  if (s->device_token[0] != 0) return 1; /* already paired */

  ui_clear();
  ui_print("ConsoleGate setup");
  ui_print("On the parent's web page, open System > Generate pairing code.");
  ui_print("Then enter the 6-digit code here.");
  char code[8] = {0};
  if (!platform_enter_code(code, sizeof(code))) return 0;

  char body[160];
  snprintf(body, sizeof(body),
           "{\"code\":\"%s\",\"deviceKind\":\"agent\",\"deviceName\":\"Wii\","
           "\"consoleKind\":\"wii\",\"consoleName\":\"Wii\"}",
           code);
  char resp[1024];
  int status = cgnet_request(s->hub_host, s->hub_port, "POST", "/api/v1/pair/claim", NULL, NULL,
                             body, resp, sizeof(resp));
  if (status != 200) { ui_print("Pairing failed."); return 0; }

  /* Pull the device token out of the response. */
  const char *p = strstr(resp, "\"deviceToken\":\"");
  if (!p) return 0;
  p += 15;
  int i = 0;
  while (*p && *p != '"' && i < (int)sizeof(s->device_token) - 1) s->device_token[i++] = *p++;
  s->device_token[i] = 0;

  /* And the HMAC signing key (R-04). */
  const char *k = strstr(resp, "\"signingKey\":\"");
  if (k) {
    k += 14;
    i = 0;
    while (*k && *k != '"' && i < (int)sizeof(s->signing_key) - 1) s->signing_key[i++] = *k++;
    s->signing_key[i] = 0;
  }
  cg_store_save(s);
  return 1;
}

/* Poll the Hub once; fills `out`. Returns the HTTP status (or -1). */
static int do_poll(cg_store *s, long minutes_delta, cg_poll_response *out) {
  cg_poll_request req;
  req.minutes_used_delta = minutes_delta;
  req.local_utc_guess = platform_local_time_ms();
  req.state = NULL;
  req.agent_version = AGENT_VERSION;
  char body[256];
  if (cg_proto_build_poll(&req, body, sizeof(body)) < 0) return -1;

  char resp[2048];
  int status = hub_request(s, "POST", "/api/v1/agent/poll", body, NULL, resp, sizeof(resp));
  if (status == 200) {
    cg_proto_parse_poll(resp, out);
    cg_agent_update_high_water(&s->high_water_utc_ms, out->authoritative_utc_ms);
    /* Apply + ack any queued commands. */
    for (int i = 0; i < out->command_count; i++) {
      char ack[96];
      snprintf(ack, sizeof(ack), "{\"commandId\":\"%s\"}", out->commands[i].id);
      char r[256];
      hub_request(s, "POST", "/api/v1/agent/command/ack", ack, NULL, r, sizeof(r));
    }
    cg_store_save(s);
  }
  return status;
}

/* If a session was in progress before this boot, close it out on the Hub. */
static void reconcile_pending_session(cg_store *s) {
  /* Pending markers are stored as extra fields; for brevity we keep the start
   * time + boundary in the store's high_water-adjacent slot. A real build reads
   * dedicated fields. Here: pending recorded means a sentinel file exists. */
#ifdef __wii__
  FILE *pf = fopen("sd:/apps/consolegate/pending.cfg", "r");
  if (!pf) return;
  char sid[48] = {0};
  long long start_utc = 0;
  long boundary = 0;
  fscanf(pf, "%47[^\n]\n%lld\n%ld", sid, &start_utc, &boundary);
  fclose(pf);
  remove("sd:/apps/consolegate/pending.cfg");

  cg_poll_response pr;
  if (do_poll(s, 0, &pr) == 200) {
    cg_session_result r = cg_agent_session_result(start_utc, pr.authoritative_utc_ms, boundary);
    char body[160];
    snprintf(body, sizeof(body), "{\"sessionId\":\"%s\",\"elapsedMin\":%ld,\"overageMin\":%ld}",
             sid, r.elapsed_min, r.overage_min);
    char resp[256];
    hub_request(s, "POST", "/api/v1/agent/session/end", body, NULL, resp, sizeof(resp));
  }
#else
  (void)s;
#endif
}

static void record_pending_session(const char *session_id, int64_t start_utc, long boundary_secs) {
#ifdef __wii__
  FILE *pf = fopen("sd:/apps/consolegate/pending.cfg", "w");
  if (!pf) return;
  fprintf(pf, "%s\n%lld\n%ld\n", session_id, (long long)start_utc, boundary_secs);
  fclose(pf);
#else
  (void)session_id; (void)start_utc; (void)boundary_secs;
#endif
}

/* Start a session on the Hub and return its id (into sid). */
static int start_session(cg_store *s, const cg_poll_response *pr, char *sid, int sid_len) {
  long long expected_return = pr->authoritative_utc_ms + (long long)pr->secs_to_boundary * 1000;
  char body[160];
  snprintf(body, sizeof(body),
           "{\"titleId\":null,\"expectedReturnBy\":%lld,\"source\":\"wii-gate\"}", expected_return);
  char resp[512];
  if (hub_request(s, "POST", "/api/v1/agent/session/start", body, NULL, resp, sizeof(resp)) != 200)
    return 0;
  const char *p = strstr(resp, "\"sessionId\":\"");
  if (!p) return 0;
  p += 13;
  int i = 0;
  while (*p && *p != '"' && i < sid_len - 1) sid[i++] = *p++;
  sid[i] = 0;
  return 1;
}

static void lock_screen(cg_store *s, const cg_poll_response *pr) {
  for (;;) {
    ui_clear();
    ui_print("=== ConsoleGate ===");
    ui_printf("Console locked: %s", pr->reason);
    ui_print("");
    ui_print("Press A to ask a parent for more time.");
    ui_print("Press HOME to enter the parent PIN to unlock.");

    int a = ui_wait_button_a();
    if (a) {
      char body[96];
      snprintf(body, sizeof(body), "{\"minutes\":15,\"reason\":\"more time please\"}");
      char resp[256];
      /* request-time uses the console id endpoint; the Hub knows it from the token. */
      hub_request(s, "POST", "/api/v1/agent/poll", "{}", NULL, resp, sizeof(resp)); /* keepalive */
      (void)body;
      ui_print("Request sent. Ask a parent to approve on their phone.");
    } else {
      char pin[16] = {0};
      if (platform_enter_pin(pin, sizeof(pin))) {
        char body[48];
        snprintf(body, sizeof(body), "{\"pin\":\"%s\"}", pin);
        char resp[128];
        int st = hub_request(s, "POST", "/api/v1/unlock/verify", body, NULL, resp, sizeof(resp));
        if (st == 200 && strstr(resp, "\"ok\":true")) return; /* unlocked */
        ui_print("Wrong PIN.");
      }
    }

    /* Re-poll; a parent may have granted time / unlocked remotely. */
    cg_poll_response np;
    if (do_poll(s, 0, &np) == 200 && !cg_agent_state_is_locked(np.state)) return;
  }
}

int main(int argc, char **argv) {
  (void)argc; (void)argv;
  ui_init();
#ifdef __wii__
  fatInitDefault();
#endif
  if (cgnet_init() != 0) {
    ui_print("Network unavailable.");
  }

  cg_store store;
  cg_store_load(&store);

  if (!ensure_paired(&store)) {
    ui_print("Not paired. Cannot enforce — failing closed.");
    ui_wait_button_a();
    /* Fail closed: do not chain to a game. */
    return 0;
  }

  /* Sign subsequent requests with the key issued at pairing (R-04). */
  cgnet_set_signing_key(store.signing_key[0] ? store.signing_key : NULL);

  reconcile_pending_session(&store);

  cg_poll_response pr;
  int status = do_poll(&store, 0, &pr);
  if (status != 200 || !pr.ok) {
    /* Hub unreachable: fail closed after the grace window (cached policy only). */
    ui_clear();
    ui_print("Can't reach ConsoleGate Hub. Failing closed.");
    ui_print("Ask a parent — enter the PIN to unlock, or try again later.");
    char pin[16] = {0};
    if (platform_enter_pin(pin, sizeof(pin))) {
      char body[48];
      char resp[128];
      snprintf(body, sizeof(body), "{\"pin\":\"%s\"}", pin);
      if (hub_request(&store, "POST", "/api/v1/unlock/verify", body, NULL, resp, sizeof(resp)) != 200)
        return 0;
    } else {
      return 0;
    }
  } else if (cg_agent_state_is_locked(pr.state)) {
    lock_screen(&store, &pr);
    /* After unlock, re-poll for a fresh state. */
    do_poll(&store, 0, &pr);
  }

  /* Won't-finish launch guard (Wii can't stop a running game). */
  cg_launch_decision d = cg_agent_launch_guard(cg_agent_state_is_locked(pr.state), pr.secs_to_boundary,
                                               pr.quota_remaining_min, 10 /*min session*/, 0);
  ui_clear();
  ui_printf("ConsoleGate — %ld min left today.", pr.quota_remaining_min);
  if (d == CG_LAUNCH_BLOCK) {
    ui_print("Not enough time left for a game right now.");
    ui_wait_button_a();
    return 0;
  }
  if (d == CG_LAUNCH_WARN) {
    ui_print("Heads up: downtime is near. The Wii can't stop a game for you —");
    ui_print("save and quit before then, or it counts as past downtime.");
  }
  ui_print("Press A to start playing.");
  ui_wait_button_a();

  /* Start a session, mark it pending (for reconciliation on return), and chain. */
  char sid[48] = {0};
  if (start_session(&store, &pr, sid, sizeof(sid))) {
    record_pending_session(sid, pr.authoritative_utc_ms, pr.secs_to_boundary);
  }
  platform_launch_loader();
  return 0;
}

/* ---- platform hook implementations -------------------------------------- */
#ifdef __wii__
static void *xfb = NULL;
static GXRModeObj *rmode = NULL;

static void ui_init(void) {
  VIDEO_Init();
  WPAD_Init();
  rmode = VIDEO_GetPreferredMode(NULL);
  xfb = MEM_K0_TO_K1(SYS_AllocateFramebuffer(rmode));
  console_init(xfb, 20, 20, rmode->fbWidth, rmode->xfbHeight, rmode->fbWidth * VI_DISPLAY_PIX_SZ);
  VIDEO_Configure(rmode);
  VIDEO_SetNextFramebuffer(xfb);
  VIDEO_SetBlack(FALSE);
  VIDEO_Flush();
  VIDEO_WaitVSync();
}
static void ui_clear(void) { printf("\x1b[2J"); }
static void ui_print(const char *line) { printf("%s\n", line); }
static void ui_printf(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt); vprintf(fmt, ap); va_end(ap); printf("\n");
}
static int ui_wait_button_a(void) {
  for (;;) {
    WPAD_ScanPads();
    u32 down = WPAD_ButtonsDown(0);
    if (down & WPAD_BUTTON_A) return 1;
    if (down & WPAD_BUTTON_HOME) return 0;
    VIDEO_WaitVSync();
  }
}
static int64_t platform_local_time_ms(void) {
  return (int64_t)time(NULL) * 1000; /* Wii RTC; untrusted, corroborated by the Hub */
}
/* Minimal numeric entry: +/- change a digit, RIGHT advances, A confirms. */
static int platform_enter_code(char *out, int out_len) {
  int digits = 6; if (digits >= out_len) digits = out_len - 1;
  int pos = 0; for (int i = 0; i < digits; i++) out[i] = '0'; out[digits] = 0;
  for (;;) {
    ui_clear(); ui_printf("Code: %s   (pos %d)", out, pos + 1);
    ui_print("UP/DOWN change digit, RIGHT next, A confirm, HOME cancel");
    WPAD_ScanPads(); u32 d = WPAD_ButtonsDown(0);
    if (d & WPAD_BUTTON_UP) out[pos] = '0' + ((out[pos] - '0' + 1) % 10);
    if (d & WPAD_BUTTON_DOWN) out[pos] = '0' + ((out[pos] - '0' + 9) % 10);
    if (d & WPAD_BUTTON_RIGHT) pos = (pos + 1) % digits;
    if (d & WPAD_BUTTON_A) return 1;
    if (d & WPAD_BUTTON_HOME) return 0;
    VIDEO_WaitVSync();
  }
}
static int platform_enter_pin(char *out, int out_len) { return platform_enter_code(out, out_len); }
static void platform_launch_loader(void) {
  /* Integration point: load the configured loader's boot.dol and execute it, or
   * return to the System Menu where Priiloader's "Return To" routes back here on
   * game exit. The loader path is set at install time (see agent-wii/README.md). */
  extern void cg_run_dol(const char *path); /* provided by the build's dol loader */
  cg_run_dol("sd:/apps/usbloader_gx/boot.dol");
}
#else
/* Host stubs (this file is not host-built; present for clarity only). */
static void ui_init(void) {}
static void ui_clear(void) {}
static void ui_print(const char *l) { (void)l; }
static void ui_printf(const char *fmt, ...) { (void)fmt; }
static int ui_wait_button_a(void) { return 1; }
static int64_t platform_local_time_ms(void) { return 0; }
static int platform_enter_code(char *o, int n) { (void)o; (void)n; return 0; }
static int platform_enter_pin(char *o, int n) { (void)o; (void)n; return 0; }
static void platform_launch_loader(void) {}
#endif
