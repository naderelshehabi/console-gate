/*
 * cg_parse_tool — reads a JSON /agent/poll response on stdin and prints the
 * fields the native agent extracts. Used to cross-check the C parser against a
 * real Hub response (see agent-core/README.md and docs test-log).
 *
 *   curl -s ... /api/v1/agent/poll | cg_parse_tool
 */
#include "cg_proto.h"
#include "cg_agent.h"
#include <stdio.h>
#include <string.h>

int main(void) {
  static char buf[8192];
  int total = 0, c;
  while ((c = fgetc(stdin)) != EOF && total < (int)sizeof(buf) - 1) buf[total++] = (char)c;
  buf[total] = '\0';

  cg_poll_response r;
  if (!cg_proto_parse_poll(buf, &r)) {
    printf("ok=0 (parse failed)\n");
    return 1;
  }
  printf("ok=1 state=%s reason=%s secs=%ld remaining=%ld enforcement=%s grace=%ld warns=%d auth=%lld source=%s commands=%d\n",
         r.state, r.reason, r.secs_to_boundary, r.quota_remaining_min, r.enforcement,
         r.grace_seconds, r.warn_count, (long long)r.authoritative_utc_ms, r.auth_source,
         r.command_count);
  for (int i = 0; i < r.command_count; i++) {
    printf("command[%d] type=%s id=%s\n", i, r.commands[i].type, r.commands[i].id);
  }
  /* Demonstrate a decision: would this state block a Wii launch? */
  cg_launch_decision d = cg_agent_launch_guard(cg_agent_state_is_locked(r.state), r.secs_to_boundary,
                                               r.quota_remaining_min, 10, 0);
  const char *names[] = {"OK", "WARN", "BLOCK"};
  printf("launch_guard=%s\n", names[d]);
  return 0;
}
