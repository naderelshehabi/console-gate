#include "cg_test.h"
#include "cg_agent.h"

void run_agent_tests(void) {
  cg_trust_cfg cfg;
  cfg.high_water_utc_ms = 1700000000000LL;
  cfg.plausible_floor_utc_ms = 1672531200000LL; /* 2023-01-01 */
  cfg.skew_tolerance_ms = 120000;               /* 2 min */

  /* Trusted: at/above high-water, small skew within tolerance. */
  CHECK_INT(cg_agent_clock_trustworthy(&cfg, 1700000000000LL), 1);
  CHECK_INT(cg_agent_clock_trustworthy(&cfg, 1700000000000LL - 30000), 1);
  /* Untrusted: rolled back beyond tolerance. */
  CHECK_INT(cg_agent_clock_trustworthy(&cfg, 1700000000000LL - 3600000), 0);
  /* Untrusted: default/reset clock below the plausibility floor. */
  CHECK_INT(cg_agent_clock_trustworthy(&cfg, 1000000LL), 0);

  /* High-water only advances. */
  int64_t hw = 100;
  cg_agent_update_high_water(&hw, 200);
  CHECK(hw == 200);
  cg_agent_update_high_water(&hw, 150);
  CHECK(hw == 200);

  /* Fail-closed grace window. */
  CHECK_INT(cg_agent_hub_grace_expired(60000, 900000), 0);   /* 1 min < 15 min */
  CHECK_INT(cg_agent_hub_grace_expired(1000000, 900000), 1); /* > 15 min */

  /* Launch guard. */
  CHECK_INT(cg_agent_launch_guard(1, 9999, 120, 10, 0), CG_LAUNCH_BLOCK); /* locked */
  CHECK_INT(cg_agent_launch_guard(0, 9999, 0, 10, 0), CG_LAUNCH_BLOCK);   /* quota 0 */
  CHECK_INT(cg_agent_launch_guard(0, 3600, 120, 10, 0), CG_LAUNCH_OK);    /* plenty of time */
  /* 5 min to boundary, min session 10 -> can't finish. */
  CHECK_INT(cg_agent_launch_guard(0, 300, 120, 10, 0), CG_LAUNCH_WARN);   /* warn (allowed) */
  CHECK_INT(cg_agent_launch_guard(0, 300, 120, 10, 1), CG_LAUNCH_BLOCK);  /* block */
  /* Quota is the binding boundary: 3 min remaining < 10 min session. */
  CHECK_INT(cg_agent_launch_guard(0, 99999, 3, 10, 1), CG_LAUNCH_BLOCK);

  /* Session accounting. */
  cg_session_result r = cg_agent_session_result(0, 30LL * 60 * 1000, 3600);
  CHECK_INT(r.elapsed_min, 30);
  CHECK_INT(r.overage_min, 0); /* boundary was 60 min away, played 30 -> no overage */

  r = cg_agent_session_result(0, 70LL * 60 * 1000, 3600); /* boundary 60 min, played 70 */
  CHECK_INT(r.elapsed_min, 70);
  CHECK_INT(r.overage_min, 10);

  r = cg_agent_session_result(1000, 1000, 0); /* zero elapsed */
  CHECK_INT(r.elapsed_min, 0);
  CHECK_INT(r.overage_min, 0);

  /* Overage rounds up to the next minute. */
  r = cg_agent_session_result(0, 3661LL * 1000, 3600); /* 61 min 1 sec, boundary 60 min */
  CHECK_INT(r.overage_min, 2);

  /* Command application. */
  cg_cached_flags f = {0, 0};
  cg_agent_apply_command(&f, "LOCK_NOW");
  CHECK_INT(f.locked, 1);
  cg_agent_apply_command(&f, "PAUSE");
  CHECK_INT(f.paused, 1);
  cg_agent_apply_command(&f, "UNLOCK");
  CHECK_INT(f.locked, 0);
  CHECK_INT(f.paused, 0);
  cg_agent_apply_command(&f, "GRANT_BONUS"); /* no effect on flags */
  CHECK_INT(f.locked, 0);

  CHECK_INT(cg_agent_state_is_locked("LOCKED"), 1);
  CHECK_INT(cg_agent_state_is_locked("ALLOWED"), 0);
}
