/*
 * net.c — Xbox 360 plugin networking over XNet/Winsock. HARDWARE LAYER (_XBOX).
 * Uses the host-tested cg_http for request building + response splitting.
 */
#include "net.h"
#include "cg_http.h"
#include <string.h>
#include <stdlib.h>

#ifdef _XBOX
#include <xtl.h>
#include <winsockx.h>
#endif

int cg360_net_init(void) {
#ifdef _XBOX
  XNetStartupParams xnsp;
  memset(&xnsp, 0, sizeof(xnsp));
  xnsp.cfgSizeOfStruct = sizeof(XNetStartupParams);
  xnsp.cfgFlags = XNET_STARTUP_BYPASS_SECURITY;
  if (XNetStartup(&xnsp) != 0) return -1;
  WSADATA wsd;
  if (WSAStartup(MAKEWORD(2, 2), &wsd) != 0) return -1;
  return 0;
#else
  return 0;
#endif
}

#ifdef _XBOX
static SOCKET connect_tcp(const char *host, int port) {
  SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (s == INVALID_SOCKET) return INVALID_SOCKET;
  /* Allow connecting to a host without a secure association. */
  BOOL on = TRUE;
  setsockopt(s, SOL_SOCKET, 0x5801 /*SO_BROADCAST/insecure*/, (const char *)&on, sizeof(on));
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons((u_short)port);
  addr.sin_addr.s_addr = inet_addr(host);
  if (connect(s, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    closesocket(s);
    return INVALID_SOCKET;
  }
  return s;
}
#endif

int cg360_discover_hub(int discovery_port, char *host_out, int host_out_len) {
#ifdef _XBOX
  SOCKET s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (s == INVALID_SOCKET) return 0;
  BOOL yes = TRUE;
  setsockopt(s, SOL_SOCKET, SO_BROADCAST, (const char *)&yes, sizeof(yes));
  struct sockaddr_in to;
  memset(&to, 0, sizeof(to));
  to.sin_family = AF_INET;
  to.sin_port = htons((u_short)discovery_port);
  to.sin_addr.s_addr = INADDR_BROADCAST;
  const char *probe = "CG_DISCOVER?v1";
  sendto(s, probe, (int)strlen(probe), 0, (struct sockaddr *)&to, sizeof(to));

  char buf[256];
  struct sockaddr_in from;
  int fromlen = sizeof(from);
  int n = recvfrom(s, buf, sizeof(buf) - 1, 0, (struct sockaddr *)&from, &fromlen);
  closesocket(s);
  if (n <= 0) return 0;
  buf[n] = '\0';
  strncpy(host_out, inet_ntoa(from.sin_addr), host_out_len - 1);
  host_out[host_out_len - 1] = '\0';
  const char *p = strstr(buf, "\"port\":");
  return p ? atoi(p + 7) : 0;
#else
  (void)discovery_port; (void)host_out; (void)host_out_len;
  return 0;
#endif
}

int cg360_request(const char *host, int port, const char *method, const char *path,
                  const char *token, const char *pin_session, const char *json_body,
                  char *resp, int resp_len) {
#ifdef _XBOX
  SOCKET s = connect_tcp(host, port);
  if (s == INVALID_SOCKET) return -1;

  char hostport[32];
  _snprintf(hostport, sizeof(hostport), "%s:%d", host, port);
  char req[1024];
  int rlen = cg_http_build_request(req, sizeof(req), method, path, hostport, token, pin_session, json_body);
  if (rlen < 0) { closesocket(s); return -1; }
  send(s, req, rlen, 0);

  char raw[4096];
  int total = 0, n;
  while ((n = recv(s, raw + total, sizeof(raw) - 1 - total, 0)) > 0) {
    total += n;
    if (total >= (int)sizeof(raw) - 1) break;
  }
  closesocket(s);
  raw[total] = '\0';

  int status = cg_http_status(raw);
  const char *body = cg_http_find_body(raw);
  if (body) {
    int copy = (int)strlen(body);
    if (copy >= resp_len) copy = resp_len - 1;
    memcpy(resp, body, copy);
    resp[copy] = '\0';
  } else {
    resp[0] = '\0';
  }
  return status;
#else
  (void)host; (void)port; (void)method; (void)path; (void)token; (void)pin_session;
  (void)json_body; (void)resp; (void)resp_len;
  return -1;
#endif
}
