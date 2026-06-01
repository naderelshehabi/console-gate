#include "cg_sign.h"
#include "cg_hmac.h"
#include <string.h>
#include <ctype.h>
#include <stdio.h>

int cg_sign(const char *key_hex, const char *method, const char *path, const char *body,
            const char *nonce, const char *ts, char *out_hex) {
  if (!key_hex || !method || !path || !nonce || !ts || !out_hex) return -1;
  const char *b = body ? body : "";

  /* SHA-256 of the body -> hex. */
  uint8_t bh[32];
  char bh_hex[65];
  cg_sha256((const uint8_t *)b, strlen(b), bh);
  cg_hex_encode(bh, 32, bh_hex);

  /* Build the canonical string with the method uppercased. */
  char canonical[1024];
  char upper[16];
  size_t i = 0;
  for (; method[i] && i < sizeof(upper) - 1; i++) upper[i] = (char)toupper((unsigned char)method[i]);
  upper[i] = '\0';

  int n = snprintf(canonical, sizeof(canonical), "%s\n%s\n%s\n%s\n%s", upper, path, bh_hex, nonce, ts);
  if (n < 0 || n >= (int)sizeof(canonical)) return -1;

  /* Decode the signing key and HMAC the canonical string. */
  uint8_t key[64];
  int keylen = cg_hex_decode(key_hex, key, sizeof(key));
  if (keylen < 0) return -1;

  uint8_t mac[32];
  cg_hmac_sha256(key, (size_t)keylen, (const uint8_t *)canonical, (size_t)n, mac);
  cg_hex_encode(mac, 32, out_hex);
  return 0;
}

int cg_sign_request_headers(const char *key_hex, const char *method, const char *path,
                            const char *body, const char *nonce, const char *ts,
                            char *out, int outlen) {
  char sig[65];
  if (cg_sign(key_hex, method, path, body, nonce, ts, sig) != 0) return -1;
  int n = snprintf(out, (size_t)outlen,
                   "X-CG-Nonce: %s\r\nX-CG-Ts: %s\r\nX-CG-Sig: %s\r\n", nonce, ts, sig);
  if (n < 0 || n >= outlen) return -1;
  return n;
}
