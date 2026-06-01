#include "cg_test.h"
#include "cg_enforce.h"

void run_enforce_tests(void) {
  /* Graduated warnings: 60/30/15/5, each fires once as the boundary nears. */
  long thr[4] = {60, 30, 15, 5};
  cg_warn_state w;
  cg_warn_init(&w, thr, 4);

  CHECK_INT(cg_warn_check(&w, 4000), -1); /* >60 min: nothing */
  CHECK_INT(cg_warn_check(&w, 3600), 60); /* exactly 60 min: fire 60 */
  CHECK_INT(cg_warn_check(&w, 3500), -1); /* still within 60, already fired */
  CHECK_INT(cg_warn_check(&w, 1800), 30); /* 30 min: fire 30 */
  CHECK_INT(cg_warn_check(&w, 900), 15);  /* 15 min */
  CHECK_INT(cg_warn_check(&w, 300), 5);   /* 5 min */
  CHECK_INT(cg_warn_check(&w, 10), -1);   /* all fired */

  /* Sparse polling that jumps past several thresholds fires the most urgent one
   * and marks the coarser ones fired too. */
  cg_warn_state w2;
  cg_warn_init(&w2, thr, 4);
  CHECK_INT(cg_warn_check(&w2, 3900), -1); /* 65 min */
  CHECK_INT(cg_warn_check(&w2, 1500), 30); /* jumped to 25 min: announce 30 (60 also marked) */
  CHECK_INT(cg_warn_check(&w2, 1400), -1); /* 60 + 30 already fired */
  CHECK_INT(cg_warn_check(&w2, 200), 5);   /* jumped past 15 -> announce 5 */

  /* Reset re-arms warnings (e.g., after a bonus grant). */
  cg_warn_reset(&w);
  CHECK_INT(cg_warn_check(&w, 1800), 30);

  /* Enforcement action selector. */
  CHECK_INT(cg_enforce_action("ALLOWED", "hard", 1), CG_ACT_NONE);
  CHECK_INT(cg_enforce_action("WARNING", "hard", 1), CG_ACT_WARN);
  CHECK_INT(cg_enforce_action("GRACE", "hard", 1), CG_ACT_GRACE);
  CHECK_INT(cg_enforce_action("LOCKED", "hard", 1), CG_ACT_FORCE_CLOSE); /* in-game hard */
  CHECK_INT(cg_enforce_action("LOCKED", "soft", 1), CG_ACT_NAG);         /* in-game soft */
  CHECK_INT(cg_enforce_action("LOCKED", "hard", 0), CG_ACT_LOCK);        /* at dashboard */
  CHECK_INT(cg_enforce_action("LOCKED", "soft", 0), CG_ACT_LOCK);

  /* Incremental minute accounting carries sub-minute remainders. */
  int64_t last = 0, carry = 0;
  CHECK_INT(cg_minutes_delta(30000, &last, &carry), 0);   /* 30s -> 0 min, carry 30s */
  CHECK_INT(cg_minutes_delta(60000, &last, &carry), 1);   /* +30s = 60s -> 1 min */
  CHECK_INT(carry, 0);
  CHECK_INT(cg_minutes_delta(60000 + 90000, &last, &carry), 1); /* +90s -> 1 min, carry 30s */
  CHECK_INT(carry, 30000);
  /* A long poll gap accrues multiple minutes at once. */
  last = 0; carry = 0;
  CHECK_INT(cg_minutes_delta(5 * 60000, &last, &carry), 5);
  /* Backward monotonic guard. */
  CHECK_INT(cg_minutes_delta(0, &last, &carry), 0);
}
