/*
 * cg_sign — build the ConsoleGate request signature the Hub verifies (R-04).
 * Canonical string: METHOD \n PATH \n SHA256HEX(body) \n NONCE \n TS
 * signed as HMAC-SHA256(signingKey, canonical) -> lowercase hex.
 * Identical to hub/src/auth/signing.ts; pinned by a cross-language test.
 */
#ifndef CG_SIGN_H
#define CG_SIGN_H

/* Write the 64-char hex signature (+NUL) into `out_hex` (>=65 bytes).
 * `key_hex` is the device signing key (hex). Returns 0 on success, -1 on error. */
int cg_sign(const char *key_hex, const char *method, const char *path, const char *body,
            const char *nonce, const char *ts, char *out_hex);

/* Build the X-CG-Nonce / X-CG-Ts / X-CG-Sig header lines (CRLF-terminated) for a
 * request into `out` (capacity `outlen`). Returns the length written, or -1. */
int cg_sign_request_headers(const char *key_hex, const char *method, const char *path,
                            const char *body, const char *nonce, const char *ts,
                            char *out, int outlen);

#endif /* CG_SIGN_H */
