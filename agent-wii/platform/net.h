/*
 * net.h — minimal HTTP/discovery client for the Wii agent (libogc sockets).
 *
 * Hardware layer: compiles only under devkitPPC/libogc (see agent-wii/Makefile),
 * not on the host. The decision logic it feeds lives in agent-core (host-tested).
 */
#ifndef CG_WII_NET_H
#define CG_WII_NET_H

/* Bring up the Wii network stack (DHCP). Returns 0 on success. */
int cgnet_init(void);

/* Discover the Hub via UDP broadcast (CG_DISCOVER?v1). On success writes the
 * Hub IP (dotted) into host_out and returns the TCP port; returns 0 on failure. */
int cgnet_discover_hub(int discovery_port, char *host_out, int host_out_len);

/* Perform a JSON HTTP request to the Hub. `token` (bearer) and `pin_session`
 * may be NULL. Writes the response body into resp (NUL-terminated). Returns the
 * HTTP status code, or -1 on transport error. */
int cgnet_request(const char *host, int port, const char *method, const char *path,
                  const char *token, const char *pin_session, const char *json_body,
                  char *resp, int resp_len);

#endif /* CG_WII_NET_H */
