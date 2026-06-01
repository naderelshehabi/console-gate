/*
 * net.h — HTTP client for the Xbox 360 plugin (XNet/Winsock sockets).
 *
 * HARDWARE LAYER: compiles under the Xbox 360 XDK (_XBOX), not on the host.
 * Request building / response splitting use the host-tested cg_http in
 * agent-core; this file only does socket I/O.
 */
#ifndef CG_360_NET_H
#define CG_360_NET_H

/* Bring up XNet. Returns 0 on success. */
int cg360_net_init(void);

/* Set the HMAC signing key (hex) used to sign requests (R-04); NULL clears it. */
void cg360_set_signing_key(const char *key_hex);

/* Discover the Hub via UDP broadcast (CG_DISCOVER?v1). Writes the Hub IP into
 * host_out and returns the TCP port, or 0 on failure. */
int cg360_discover_hub(int discovery_port, char *host_out, int host_out_len);

/* Perform a JSON HTTP request. token / pin_session may be NULL. Writes the body
 * into resp (NUL-terminated). Returns the HTTP status, or -1 on transport error. */
int cg360_request(const char *host, int port, const char *method, const char *path,
                  const char *token, const char *pin_session, const char *json_body,
                  char *resp, int resp_len);

#endif /* CG_360_NET_H */
