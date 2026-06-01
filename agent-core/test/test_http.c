#include "cg_test.h"
#include "cg_http.h"
#include <string.h>

void run_http_tests(void) {
  char buf[1024];

  /* Full request with auth + body. */
  int n = cg_http_build_request(buf, sizeof(buf), "POST", "/api/v1/agent/poll",
                                "192.168.1.10:8088", "tok123", NULL, "{\"minutesUsedDelta\":5}");
  CHECK(n > 0);
  CHECK(strstr(buf, "POST /api/v1/agent/poll HTTP/1.1\r\n") == buf);
  CHECK(strstr(buf, "Host: 192.168.1.10:8088\r\n") != NULL);
  CHECK(strstr(buf, "Connection: close\r\n") != NULL);
  CHECK(strstr(buf, "Authorization: Bearer tok123\r\n") != NULL);
  CHECK(strstr(buf, "Content-Length: 22\r\n") != NULL);
  CHECK(strstr(buf, "\r\n\r\n{\"minutesUsedDelta\":5}") != NULL);
  CHECK(strstr(buf, "X-Pin-Session") == NULL);

  /* With a PIN session header and no body. */
  n = cg_http_build_request(buf, sizeof(buf), "POST", "/x", "h", "t", "pinsess", NULL);
  CHECK(n > 0);
  CHECK(strstr(buf, "X-Pin-Session: pinsess\r\n") != NULL);
  CHECK(strstr(buf, "Content-Length: 0\r\n") != NULL);

  /* Overflow guard. */
  char tiny[16];
  CHECK_INT(cg_http_build_request(tiny, sizeof(tiny), "POST", "/api/v1/agent/poll", "host", NULL, NULL, "{}"), -1);

  /* Status parsing. */
  CHECK_INT(cg_http_status("HTTP/1.1 200 OK\r\n\r\n{}"), 200);
  CHECK_INT(cg_http_status("HTTP/1.1 401 Unauthorized\r\n\r\n"), 401);
  CHECK_INT(cg_http_status("garbage"), 0);

  /* Body splitting. */
  const char *resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"a\":1}";
  const char *body = cg_http_find_body(resp);
  CHECK(body != NULL);
  CHECK_STR(body, "{\"a\":1}");
  CHECK(cg_http_find_body("no separator here") == NULL);
}
