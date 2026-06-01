/*
 * cg_enforce — portable enforcement helpers for in-game agents (primarily the
 * Xbox 360 plugin, which overlays warnings during play and force-closes at
 * downtime). Pure logic, host-unit-tested. Shared via agent-core.
 *
 * References: docs/implement/04-console-xbox360.md (overlays, grace, force-close),
 *             docs/implement/01-research-findings.md §C (graduated warnings).
 */
#ifndef CG_ENFORCE_H
#define CG_ENFORCE_H

#include <stdint.h>
#include "cg_proto.h" /* CG_MAX_WARN */

/* ---- graduated warning scheduler -------------------------------------- */

typedef struct {
  long thresholds_min[CG_MAX_WARN];
  int count;
  unsigned fired_mask; /* bit i = threshold i already announced */
} cg_warn_state;

void cg_warn_init(cg_warn_state *w, const long *thresholds_min, int count);

/* Reset fired flags — call when the budget grows (bonus granted) or a new day/
 * session starts, so warnings can fire again. */
void cg_warn_reset(cg_warn_state *w);

/* Given the current seconds-to-boundary, return the threshold (in minutes) that
 * should be announced now (the most urgent newly-crossed one), marking it and any
 * coarser crossed thresholds as fired. Returns -1 if no new warning is due. */
long cg_warn_check(cg_warn_state *w, long secs_to_boundary);

/* ---- enforcement action selector -------------------------------------- */

typedef enum {
  CG_ACT_NONE = 0,
  CG_ACT_WARN,        /* show a warning overlay over the game */
  CG_ACT_GRACE,       /* show the save-countdown */
  CG_ACT_FORCE_CLOSE, /* hard mode: XLaunchNewImage back to the dashboard */
  CG_ACT_NAG,         /* soft mode: persistent overlay + PLAY_BEYOND_DOWNTIME */
  CG_ACT_LOCK         /* not in a game: show the lock screen */
} cg_action;

/* Decide what the agent should do for an effective state. `in_game` is 1 while a
 * title is running (vs. sitting at the dashboard). `enforcement` is "soft"/"hard". */
cg_action cg_enforce_action(const char *state, const char *enforcement, int in_game);

/* ---- incremental monotonic minute accounting -------------------------- */

/* Accumulate elapsed monotonic time across polls and return the WHOLE minutes to
 * report since the last call, carrying the sub-minute remainder so no time is
 * lost. `mono_last_ms` and `carry_ms` are caller-held state (init to mono start
 * and 0). Clock-independent — used for the poll's minutesUsedDelta during play. */
long cg_minutes_delta(int64_t mono_now_ms, int64_t *mono_last_ms, int64_t *carry_ms);

#endif /* CG_ENFORCE_H */
