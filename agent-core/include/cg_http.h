/*
 * cg_http — portable HTTP/1.1 request building and response splitting, so the
 * platform net layers (libogc on Wii, Winsock/XNet on the 360) only do socket
 * I/O. Pure string operations, host-unit-tested. Shared via agent-core.
 */
#ifndef CG_HTTP_H
#define CG_HTTP_H

/* Build a complete HTTP/1.1 request (headers + body) into `buf`. `token` and
 * `pin_session` are optional (NULL to omit). `extra_headers`, if non-NULL, is
 * inserted verbatim (each line CRLF-terminated) — used for the X-CG-* signing
 * headers. `json_body` may be NULL/empty. Always sends Connection: close.
 * Returns the byte length written (excluding NUL), or -1 on overflow. */
int cg_http_build_request(char *buf, int buflen, const char *method, const char *path,
                          const char *host, const char *token, const char *pin_session,
                          const char *extra_headers, const char *json_body);

/* Parse the numeric status code from an HTTP response's status line. 0 if absent. */
int cg_http_status(const char *response);

/* Return a pointer into `response` at the start of the body (after the CRLFCRLF
 * header terminator), or NULL if no body separator is present. */
const char *cg_http_find_body(const char *response);

#endif /* CG_HTTP_H */
