#include "cg_enforce.h"
#include <string.h>

void cg_warn_init(cg_warn_state *w, const long *thresholds_min, int count) {
  if (!w) return;
  if (count > CG_MAX_WARN) count = CG_MAX_WARN;
  w->count = count;
  w->fired_mask = 0;
  for (int i = 0; i < count; i++) w->thresholds_min[i] = thresholds_min[i];
}

void cg_warn_reset(cg_warn_state *w) {
  if (w) w->fired_mask = 0;
}

long cg_warn_check(cg_warn_state *w, long secs_to_boundary) {
  if (!w) return -1;
  long best = -1; /* most urgent (smallest) newly-crossed threshold */
  for (int i = 0; i < w->count; i++) {
    long t = w->thresholds_min[i];
    int crossed = (t * 60 >= secs_to_boundary);
    int fired = (w->fired_mask & (1u << i)) != 0;
    if (crossed && !fired) {
      w->fired_mask |= (1u << i);
      if (best < 0 || t < best) best = t;
    }
  }
  return best;
}

cg_action cg_enforce_action(const char *state, const char *enforcement, int in_game) {
  if (!state) return CG_ACT_NONE;
  if (strcmp(state, "ALLOWED") == 0) return CG_ACT_NONE;
  if (strcmp(state, "WARNING") == 0) return CG_ACT_WARN;
  if (strcmp(state, "GRACE") == 0) return CG_ACT_GRACE;
  if (strcmp(state, "LOCKED") == 0) {
    if (!in_game) return CG_ACT_LOCK;
    int soft = (enforcement && strcmp(enforcement, "soft") == 0);
    return soft ? CG_ACT_NAG : CG_ACT_FORCE_CLOSE;
  }
  return CG_ACT_NONE;
}

long cg_minutes_delta(int64_t mono_now_ms, int64_t *mono_last_ms, int64_t *carry_ms) {
  if (!mono_last_ms || !carry_ms) return 0;
  int64_t delta = mono_now_ms - *mono_last_ms;
  if (delta < 0) delta = 0; /* monotonic never goes backwards; guard anyway */
  int64_t total = delta + *carry_ms;
  long minutes = (long)(total / 60000);
  *carry_ms = total % 60000;
  *mono_last_ms = mono_now_ms;
  return minutes;
}
