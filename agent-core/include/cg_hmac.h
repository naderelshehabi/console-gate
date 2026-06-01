/*
 * cg_hmac — SHA-256 and HMAC-SHA256 for the agents' request signing (R-04).
 * Self-contained C99 (no crypto library), host-unit-tested against published
 * vectors and cross-pinned to the Hub's Node implementation. Shared via agent-core.
 */
#ifndef CG_HMAC_H
#define CG_HMAC_H

#include <stddef.h>
#include <stdint.h>

/* Raw SHA-256 of `len` bytes -> 32-byte digest. */
void cg_sha256(const uint8_t *data, size_t len, uint8_t out[32]);

/* HMAC-SHA256(key, data) -> 32-byte digest. */
void cg_hmac_sha256(const uint8_t *key, size_t keylen, const uint8_t *data, size_t datalen, uint8_t out[32]);

/* Lowercase-hex encode `len` bytes into `out` (needs 2*len+1 chars). */
void cg_hex_encode(const uint8_t *in, size_t len, char *out);

/* Decode hex into `out` (capacity outcap). Returns bytes written, or -1 on error. */
int cg_hex_decode(const char *hex, uint8_t *out, size_t outcap);

#endif /* CG_HMAC_H */
