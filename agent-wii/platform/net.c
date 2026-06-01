/*
 * net.c — Wii agent networking over libogc sockets. HARDWARE LAYER: requires
 * devkitPPC + libogc; does not build on the host. Kept deliberately small; the
 * tested decision logic is in agent-core.
 */
#include "net.h"
#include "cg_http.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#ifdef __wii__
#include <network.h>
#include <unistd.h>
#else
/* Host stubs so editors/linters don't choke; the real build defines __wii__. */
#include <stdint.h>
#endif

int cgnet_init(void) {
#ifdef __wii__
  char localip[16] = {0};
  char gateway[16] = {0};
  char netmask[16] = {0};
  int ret = if_config(localip, netmask, gateway, 1 /*use DHCP*/, 20 /*retries*/);
  return (ret >= 0) ? 0 : -1;
#else
  return 0;
#endif
}

#ifdef __wii__
static int connect_tcp(const char *host, int port) {
  s32 sock = net_socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (sock < 0) return -1;
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons(port);
  addr.sin_addr.s_addr = inet_addr(host);
  if (net_connect(sock, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
    net_close(sock);
    return -1;
  }
  return sock;
}
#endif

int cgnet_discover_hub(int discovery_port, char *host_out, int host_out_len) {
#ifdef __wii__
  s32 sock = net_socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (sock < 0) return 0;
  u32 yes = 1;
  net_setsockopt(sock, SOL_SOCKET, SO_BROADCAST, &yes, sizeof(yes));

  struct sockaddr_in to;
  memset(&to, 0, sizeof(to));
  to.sin_family = AF_INET;
  to.sin_port = htons(discovery_port);
  to.sin_addr.s_addr = INADDR_BROADCAST;
  const char *probe = "CG_DISCOVER?v1";
  net_sendto(sock, probe, strlen(probe), 0, (struct sockaddr *)&to, sizeof(to));

  /* Wait briefly for a unicast reply: {"hubId":...,"port":N,...}. */
  char buf[256];
  struct sockaddr_in from;
  socklen_t fromlen = sizeof(from);
  /* (Production: set a recv timeout via net_setsockopt SO_RCVTIMEO.) */
  int n = net_recvfrom(sock, buf, sizeof(buf) - 1, 0, (struct sockaddr *)&from, &fromlen);
  net_close(sock);
  if (n <= 0) return 0;
  buf[n] = '\0';

  /* The replying address is the Hub; parse the port out of the JSON. */
  inet_ntop(AF_INET, &from.sin_addr, host_out, host_out_len);
  const char *p = strstr(buf, "\"port\":");
  if (!p) return 0;
  return atoi(p + 7);
#else
  (void)discovery_port; (void)host_out; (void)host_out_len;
  return 0;
#endif
}

int cgnet_request(const char *host, int port, const char *method, const char *path,
                  const char *token, const char *pin_session, const char *json_body,
                  char *resp, int resp_len) {
#ifdef __wii__
  int sock = connect_tcp(host, port);
  if (sock < 0) return -1;

  /* Build the request with the host-tested helper (agent-core/cg_http). */
  char hostport[24];
  snprintf(hostport, sizeof(hostport), "%s:%d", host, port);
  char req[1024];
  int rlen = cg_http_build_request(req, sizeof(req), method, path, hostport, token, pin_session, json_body);
  if (rlen < 0) { net_close(sock); return -1; }
  net_send(sock, req, rlen, 0);

  /* Read the whole response (Connection: close => read to EOF). */
  char raw[4096];
  int total = 0, n;
  while ((n = net_recv(sock, raw + total, sizeof(raw) - 1 - total, 0)) > 0) {
    total += n;
    if (total >= (int)sizeof(raw) - 1) break;
  }
  net_close(sock);
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
