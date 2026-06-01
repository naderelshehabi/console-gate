#include "cg_test.h"
#include "cg_proto.h"
#include <string.h>

void run_proto_tests(void) {
  char buf[256];

  /* Build with all fields. */
  cg_poll_request req;
  req.minutes_used_delta = 5;
  req.local_utc_guess = 1700000000000LL;
  req.state = "ALLOWED";
  req.agent_version = "wii-0.1.0";
  int n = cg_proto_build_poll(&req, buf, sizeof(buf));
  CHECK(n > 0);
  CHECK(strstr(buf, "\"minutesUsedDelta\":5") != NULL);
  CHECK(strstr(buf, "\"localUtcGuess\":1700000000000") != NULL);
  CHECK(strstr(buf, "\"state\":\"ALLOWED\"") != NULL);
  CHECK(strstr(buf, "\"agentVersion\":\"wii-0.1.0\"") != NULL);

  /* Build omitting optional fields. */
  cg_poll_request req2;
  req2.minutes_used_delta = 0;
  req2.local_utc_guess = -1;
  req2.state = NULL;
  req2.agent_version = NULL;
  n = cg_proto_build_poll(&req2, buf, sizeof(buf));
  CHECK(n > 0);
  CHECK(strstr(buf, "localUtcGuess") == NULL);
  CHECK(strstr(buf, "\"minutesUsedDelta\":0") != NULL);

  /* Overflow guard. */
  char tiny[8];
  CHECK_INT(cg_proto_build_poll(&req, tiny, sizeof(tiny)), -1);

  /* Parse a realistic Hub poll response. */
  const char *resp =
      "{\"authoritative\":{\"utcMs\":1700000000500,\"source\":\"ntp\",\"monoToken\":\"abc\"},"
      "\"effective\":{\"state\":\"WARNING\",\"reason\":\"quota-end\","
      "\"secondsToNextBoundary\":300,\"quotaRemainingMin\":5,"
      "\"warnThresholdsMin\":[60,30,15,5],\"graceSeconds\":60,\"enforcement\":\"hard\"},"
      "\"commands\":[{\"id\":\"cmd-1\",\"type\":\"LOCK_NOW\",\"args\":{},\"nonce\":\"n\",\"ts\":1}]}";
  cg_poll_response out;
  int ok = cg_proto_parse_poll(resp, &out);
  CHECK_INT(ok, 1);
  CHECK_INT(out.ok, 1);
  CHECK_STR(out.state, "WARNING");
  CHECK_STR(out.reason, "quota-end");
  CHECK_INT(out.secs_to_boundary, 300);
  CHECK_INT(out.quota_remaining_min, 5);
  CHECK_STR(out.enforcement, "hard");
  CHECK_INT(out.grace_seconds, 60);
  CHECK_INT(out.warn_count, 4);
  CHECK_INT(out.warn_thresholds[0], 60);
  CHECK(out.authoritative_utc_ms == 1700000000500LL);
  CHECK_STR(out.auth_source, "ntp");
  CHECK_INT(out.command_count, 1);
  CHECK_STR(out.commands[0].type, "LOCK_NOW");
  CHECK_STR(out.commands[0].id, "cmd-1");

  /* Parse a LOCKED response with no commands. */
  const char *locked =
      "{\"authoritative\":{\"utcMs\":1,\"source\":\"host\"},"
      "\"effective\":{\"state\":\"LOCKED\",\"reason\":\"outside-window\","
      "\"secondsToNextBoundary\":0,\"quotaRemainingMin\":0,"
      "\"warnThresholdsMin\":[],\"graceSeconds\":60,\"enforcement\":\"hard\"},"
      "\"commands\":[]}";
  ok = cg_proto_parse_poll(locked, &out);
  CHECK_INT(ok, 1);
  CHECK_STR(out.state, "LOCKED");
  CHECK_INT(out.command_count, 0);

  /* Malformed response -> ok = 0. */
  ok = cg_proto_parse_poll("{not json", &out);
  CHECK_INT(ok, 0);
  CHECK_INT(out.ok, 0);

  /* Valid JSON but missing effective state -> ok = 0. */
  ok = cg_proto_parse_poll("{\"authoritative\":{\"utcMs\":1}}", &out);
  CHECK_INT(ok, 0);
}
