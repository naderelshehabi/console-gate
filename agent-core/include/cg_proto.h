/*
 * cg_proto — ConsoleGate Hub wire protocol helpers for the agents.
 * Builds the /agent/poll request body and parses its response into a struct.
 * Portable C99 (uses cg_json). Host-unit-tested.
 *
 * Contract: docs/implement/08-protocol-api.md §8.6.
 */
#ifndef CG_PROTO_H
#define CG_PROTO_H

#include <stdint.h>

#define CG_MAX_COMMANDS 8
#define CG_MAX_WARN 8

typedef struct {
  char type[20]; /* e.g. LOCK_NOW */
  char id[48];   /* command id for ack */
} cg_command;

typedef struct {
  int ok; /* 1 if parsed successfully */

  /* effective state */
  char state[16];      /* ALLOWED|WARNING|GRACE|LOCKED */
  char reason[40];
  long secs_to_boundary;
  long quota_remaining_min;
  char enforcement[8]; /* soft|hard */
  long grace_seconds;
  long warn_thresholds[CG_MAX_WARN];
  int warn_count;

  /* authoritative time */
  int64_t authoritative_utc_ms;
  char auth_source[12]; /* ntp|host|degraded */

  /* commands */
  cg_command commands[CG_MAX_COMMANDS];
  int command_count;
} cg_poll_response;

typedef struct {
  long minutes_used_delta;  /* >= 0 */
  int64_t local_utc_guess;  /* the console's own clock; < 0 to omit */
  const char *state;        /* current agent state string, may be NULL */
  const char *agent_version; /* may be NULL */
} cg_poll_request;

/* Build a JSON body for POST /agent/poll into `buf`. Returns the number of bytes
 * written (excluding NUL), or -1 if it would overflow. */
int cg_proto_build_poll(const cg_poll_request *req, char *buf, int buflen);

/* Parse a POST /agent/poll response body. Returns 1 on success (and fills out),
 * 0 on malformed input (out->ok is also set accordingly). */
int cg_proto_parse_poll(const char *json, cg_poll_response *out);

#endif /* CG_PROTO_H */
