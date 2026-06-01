#include "cg_proto.h"
#include "cg_json.h"
#include <stdio.h>
#include <string.h>

static void copy_str(char *dst, int dstlen, const char *src) {
  if (!src) { dst[0] = '\0'; return; }
  int i = 0;
  for (; src[i] && i < dstlen - 1; i++) dst[i] = src[i];
  dst[i] = '\0';
}

int cg_proto_build_poll(const cg_poll_request *req, char *buf, int buflen) {
  if (!req || !buf || buflen <= 0) return -1;
  int n;
  /* Compose incrementally so optional fields can be omitted. */
  int len = 0;
  n = snprintf(buf + len, buflen - len, "{\"minutesUsedDelta\":%ld", req->minutes_used_delta);
  if (n < 0 || n >= buflen - len) return -1;
  len += n;

  if (req->local_utc_guess >= 0) {
    n = snprintf(buf + len, buflen - len, ",\"localUtcGuess\":%lld", (long long)req->local_utc_guess);
    if (n < 0 || n >= buflen - len) return -1;
    len += n;
  }
  if (req->state) {
    n = snprintf(buf + len, buflen - len, ",\"state\":\"%s\"", req->state);
    if (n < 0 || n >= buflen - len) return -1;
    len += n;
  }
  if (req->agent_version) {
    n = snprintf(buf + len, buflen - len, ",\"agentVersion\":\"%s\"", req->agent_version);
    if (n < 0 || n >= buflen - len) return -1;
    len += n;
  }
  n = snprintf(buf + len, buflen - len, "}");
  if (n < 0 || n >= buflen - len) return -1;
  len += n;
  return len;
}

int cg_proto_parse_poll(const char *json, cg_poll_response *out) {
  if (!out) return 0;
  memset(out, 0, sizeof(*out));

  cg_json *root = cg_json_parse(json);
  if (!root || cg_json_typeof(root) != CG_JSON_OBJ) {
    cg_json_free(root);
    out->ok = 0;
    return 0;
  }

  const cg_json *eff = cg_json_get(root, "effective");
  if (eff) {
    copy_str(out->state, sizeof(out->state), cg_json_get_str(eff, "state", ""));
    copy_str(out->reason, sizeof(out->reason), cg_json_get_str(eff, "reason", ""));
    out->secs_to_boundary = (long)cg_json_get_num(eff, "secondsToNextBoundary", 0);
    out->quota_remaining_min = (long)cg_json_get_num(eff, "quotaRemainingMin", 0);
    copy_str(out->enforcement, sizeof(out->enforcement), cg_json_get_str(eff, "enforcement", "hard"));
    out->grace_seconds = (long)cg_json_get_num(eff, "graceSeconds", 0);
    const cg_json *warns = cg_json_get(eff, "warnThresholdsMin");
    int wlen = cg_json_len(warns);
    for (int i = 0; i < wlen && out->warn_count < CG_MAX_WARN; i++) {
      out->warn_thresholds[out->warn_count++] = (long)cg_json_num(cg_json_at(warns, i), 0);
    }
  }

  const cg_json *auth = cg_json_get(root, "authoritative");
  if (auth) {
    out->authoritative_utc_ms = (int64_t)cg_json_get_num(auth, "utcMs", 0);
    copy_str(out->auth_source, sizeof(out->auth_source), cg_json_get_str(auth, "source", ""));
  }

  const cg_json *cmds = cg_json_get(root, "commands");
  int clen = cg_json_len(cmds);
  for (int i = 0; i < clen && out->command_count < CG_MAX_COMMANDS; i++) {
    const cg_json *c = cg_json_at(cmds, i);
    cg_command *dst = &out->commands[out->command_count++];
    copy_str(dst->type, sizeof(dst->type), cg_json_get_str(c, "type", ""));
    copy_str(dst->id, sizeof(dst->id), cg_json_get_str(c, "id", ""));
  }

  cg_json_free(root);
  /* A valid poll response must at least carry an effective state. */
  out->ok = (out->state[0] != '\0') ? 1 : 0;
  return out->ok;
}
