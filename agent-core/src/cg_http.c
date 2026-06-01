#include "cg_http.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

int cg_http_build_request(char *buf, int buflen, const char *method, const char *path,
                          const char *host, const char *token, const char *pin_session,
                          const char *json_body) {
  if (!buf || buflen <= 0 || !method || !path || !host) return -1;
  int blen = json_body ? (int)strlen(json_body) : 0;
  int n = snprintf(
      buf, buflen,
      "%s %s HTTP/1.1\r\n"
      "Host: %s\r\n"
      "Connection: close\r\n"
      "%s%s%s"
      "%s%s%s"
      "Content-Type: application/json\r\n"
      "Content-Length: %d\r\n"
      "\r\n"
      "%s",
      method, path, host,
      token ? "Authorization: Bearer " : "", token ? token : "", token ? "\r\n" : "",
      pin_session ? "X-Pin-Session: " : "", pin_session ? pin_session : "", pin_session ? "\r\n" : "",
      blen, json_body ? json_body : "");
  if (n < 0 || n >= buflen) return -1;
  return n;
}

int cg_http_status(const char *response) {
  if (!response) return 0;
  /* Expect "HTTP/1.x SSS ..." */
  const char *sp = strchr(response, ' ');
  if (!sp) return 0;
  return atoi(sp + 1);
}

const char *cg_http_find_body(const char *response) {
  if (!response) return NULL;
  const char *sep = strstr(response, "\r\n\r\n");
  if (sep) return sep + 4;
  /* Tolerate bare-LF terminators. */
  sep = strstr(response, "\n\n");
  if (sep) return sep + 2;
  return NULL;
}
