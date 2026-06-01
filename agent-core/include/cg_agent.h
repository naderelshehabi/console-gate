/*
 * cg_agent — portable, platform-independent decision logic shared by the
 * ConsoleGate Wii and Xbox 360 agents. No I/O, no platform calls: pure functions
 * the platform layer (libogc / XDK) drives. Host-unit-tested.
 *
 * Design references:
 *   docs/implement/09-time-and-tamper.md  (time-trust, fail-closed grace)
 *   docs/implement/05-console-wii.md       (won't-finish launch guard)
 */
#ifndef CG_AGENT_H
#define CG_AGENT_H

#include <stdint.h>

/* ---- time-trust -------------------------------------------------------- */

typedef struct {
  int64_t high_water_utc_ms;   /* max authoritative time the agent has acknowledged */
  int64_t plausible_floor_utc_ms; /* a clock below this is a default/reset clock */
  int64_t skew_tolerance_ms;   /* tolerance before a backward report = tampering */
} cg_trust_cfg;

/* 1 if the console's reported clock can be trusted, 0 if it looks rolled-back or
 * reset (the agent must then fail closed). Mirrors the Hub evaluator. */
int cg_agent_clock_trustworthy(const cg_trust_cfg *cfg, int64_t reported_local_utc_ms);

/* Advance a persisted high-water mark to `authoritative_now` (never backwards). */
void cg_agent_update_high_water(int64_t *high_water_utc_ms, int64_t authoritative_now_ms);

/* ---- fail-closed grace window ----------------------------------------- */

/* 1 if the Hub has been unreachable longer than the grace window (=> LOCKED
 * hub-unreachable). Until then the agent enforces its cached policy. */
int cg_agent_hub_grace_expired(int64_t ms_since_last_contact, int64_t grace_window_ms);

/* ---- Wii won't-finish launch guard ------------------------------------ */

typedef enum {
  CG_LAUNCH_OK = 0,    /* fine to launch */
  CG_LAUNCH_WARN = 1,  /* launch, but the session can't finish before downtime */
  CG_LAUNCH_BLOCK = 2  /* refuse to launch */
} cg_launch_decision;

/* Decide whether a game may be launched right now (Wii: no mid-game stop). */
cg_launch_decision cg_agent_launch_guard(int state_locked,
                                         long secs_to_boundary,
                                         long quota_remaining_min,
                                         long wii_min_session_min,
                                         int block_unfinishable);

/* ---- session accounting ----------------------------------------------- */

typedef struct {
  long elapsed_min;  /* whole minutes of play (monotonic; clock-independent) */
  long overage_min;  /* minutes played past the boundary that existed at launch */
} cg_session_result;

/* Compute a finished session's elapsed + overage from monotonic start/end ticks
 * and the seconds-to-boundary that applied at launch. */
cg_session_result cg_agent_session_result(int64_t mono_start_ms,
                                          int64_t mono_end_ms,
                                          long secs_to_boundary_at_launch);

/* ---- cached lock state (offline command application) ------------------ */

typedef struct {
  int locked;  /* parent lock-now */
  int paused;
} cg_cached_flags;

/* Apply a Hub command ("LOCK_NOW","UNLOCK","PAUSE","RESUME","GRANT_BONUS",
 * "RESYNC") to the agent's locally cached flags. Unknown commands are ignored. */
void cg_agent_apply_command(cg_cached_flags *flags, const char *cmd_type);

/* 1 if, given a cached effective-state string, the console should be locked. */
int cg_agent_state_is_locked(const char *state);

#endif /* CG_AGENT_H */
