#include "cg_agent.h"
#include <string.h>

int cg_agent_clock_trustworthy(const cg_trust_cfg *cfg, int64_t reported_local_utc_ms) {
  if (!cfg) return 1;
  /* Backward jump below the high-water mark (beyond tolerance) => tampered. */
  if (reported_local_utc_ms < cfg->high_water_utc_ms - cfg->skew_tolerance_ms) return 0;
  /* Default/reset clock (e.g. 360 after a long unplug) => untrusted. */
  if (reported_local_utc_ms < cfg->plausible_floor_utc_ms) return 0;
  return 1;
}

void cg_agent_update_high_water(int64_t *high_water_utc_ms, int64_t authoritative_now_ms) {
  if (!high_water_utc_ms) return;
  if (authoritative_now_ms > *high_water_utc_ms) *high_water_utc_ms = authoritative_now_ms;
}

int cg_agent_hub_grace_expired(int64_t ms_since_last_contact, int64_t grace_window_ms) {
  return ms_since_last_contact > grace_window_ms ? 1 : 0;
}

cg_launch_decision cg_agent_launch_guard(int state_locked,
                                         long secs_to_boundary,
                                         long quota_remaining_min,
                                         long wii_min_session_min,
                                         int block_unfinishable) {
  if (state_locked || quota_remaining_min <= 0) return CG_LAUNCH_BLOCK;

  /* The binding boundary is whichever is sooner: schedule window end or quota. */
  long secs_quota = quota_remaining_min * 60;
  long secs = secs_to_boundary < secs_quota ? secs_to_boundary : secs_quota;
  long min_secs = wii_min_session_min * 60;

  if (secs < min_secs) {
    return block_unfinishable ? CG_LAUNCH_BLOCK : CG_LAUNCH_WARN;
  }
  return CG_LAUNCH_OK;
}

cg_session_result cg_agent_session_result(int64_t mono_start_ms,
                                          int64_t mono_end_ms,
                                          long secs_to_boundary_at_launch) {
  cg_session_result r;
  int64_t elapsed_ms = mono_end_ms - mono_start_ms;
  if (elapsed_ms < 0) elapsed_ms = 0;
  long elapsed_sec = (long)(elapsed_ms / 1000);
  r.elapsed_min = elapsed_sec / 60;

  long over_sec = elapsed_sec - secs_to_boundary_at_launch;
  if (over_sec < 0) over_sec = 0;
  /* Round overage up to the next minute so any overrun is reported. */
  r.overage_min = (over_sec + 59) / 60;
  return r;
}

void cg_agent_apply_command(cg_cached_flags *flags, const char *cmd_type) {
  if (!flags || !cmd_type) return;
  if (strcmp(cmd_type, "LOCK_NOW") == 0) {
    flags->locked = 1;
  } else if (strcmp(cmd_type, "UNLOCK") == 0) {
    flags->locked = 0;
    flags->paused = 0;
  } else if (strcmp(cmd_type, "PAUSE") == 0) {
    flags->paused = 1;
  } else if (strcmp(cmd_type, "RESUME") == 0) {
    flags->paused = 0;
  }
  /* GRANT_BONUS / RESYNC have no effect on cached lock flags. */
}

int cg_agent_state_is_locked(const char *state) {
  return (state && strcmp(state, "LOCKED") == 0) ? 1 : 0;
}
