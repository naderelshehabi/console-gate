#include "cg_hmac.h"
#include <string.h>

/* ---- SHA-256 (FIPS 180-4) ---------------------------------------------- */

typedef struct {
  uint32_t state[8];
  uint64_t bitlen;
  uint8_t data[64];
  uint32_t datalen;
} sha256_ctx;

static const uint32_t K[64] = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

#define ROTR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))

static void sha256_transform(sha256_ctx *c, const uint8_t *data) {
  uint32_t a, b, cc, d, e, f, g, h, t1, t2, m[64];
  for (int i = 0, j = 0; i < 16; i++, j += 4)
    m[i] = (uint32_t)(data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3];
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = ROTR(m[i - 15], 7) ^ ROTR(m[i - 15], 18) ^ (m[i - 15] >> 3);
    uint32_t s1 = ROTR(m[i - 2], 17) ^ ROTR(m[i - 2], 19) ^ (m[i - 2] >> 10);
    m[i] = m[i - 16] + s0 + m[i - 7] + s1;
  }
  a = c->state[0]; b = c->state[1]; cc = c->state[2]; d = c->state[3];
  e = c->state[4]; f = c->state[5]; g = c->state[6]; h = c->state[7];
  for (int i = 0; i < 64; i++) {
    uint32_t S1 = ROTR(e, 6) ^ ROTR(e, 11) ^ ROTR(e, 25);
    uint32_t ch = (e & f) ^ ((~e) & g);
    t1 = h + S1 + ch + K[i] + m[i];
    uint32_t S0 = ROTR(a, 2) ^ ROTR(a, 13) ^ ROTR(a, 22);
    uint32_t maj = (a & b) ^ (a & cc) ^ (b & cc);
    t2 = S0 + maj;
    h = g; g = f; f = e; e = d + t1; d = cc; cc = b; b = a; a = t1 + t2;
  }
  c->state[0] += a; c->state[1] += b; c->state[2] += cc; c->state[3] += d;
  c->state[4] += e; c->state[5] += f; c->state[6] += g; c->state[7] += h;
}

static void sha256_init(sha256_ctx *c) {
  c->datalen = 0;
  c->bitlen = 0;
  c->state[0] = 0x6a09e667; c->state[1] = 0xbb67ae85; c->state[2] = 0x3c6ef372; c->state[3] = 0xa54ff53a;
  c->state[4] = 0x510e527f; c->state[5] = 0x9b05688c; c->state[6] = 0x1f83d9ab; c->state[7] = 0x5be0cd19;
}

static void sha256_update(sha256_ctx *c, const uint8_t *data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    c->data[c->datalen++] = data[i];
    if (c->datalen == 64) {
      sha256_transform(c, c->data);
      c->bitlen += 512;
      c->datalen = 0;
    }
  }
}

static void sha256_final(sha256_ctx *c, uint8_t out[32]) {
  uint32_t i = c->datalen;
  c->data[i++] = 0x80;
  if (c->datalen < 56) {
    while (i < 56) c->data[i++] = 0;
  } else {
    while (i < 64) c->data[i++] = 0;
    sha256_transform(c, c->data);
    memset(c->data, 0, 56);
  }
  c->bitlen += (uint64_t)c->datalen * 8;
  for (int j = 0; j < 8; j++) c->data[63 - j] = (uint8_t)(c->bitlen >> (j * 8));
  sha256_transform(c, c->data);
  for (i = 0; i < 4; i++)
    for (int j = 0; j < 8; j++) out[i + j * 4] = (uint8_t)(c->state[j] >> (24 - i * 8));
}

void cg_sha256(const uint8_t *data, size_t len, uint8_t out[32]) {
  sha256_ctx c;
  sha256_init(&c);
  sha256_update(&c, data, len);
  sha256_final(&c, out);
}

/* ---- HMAC-SHA256 ------------------------------------------------------- */

void cg_hmac_sha256(const uint8_t *key, size_t keylen, const uint8_t *data, size_t datalen, uint8_t out[32]) {
  uint8_t k[64];
  uint8_t ipad[64], opad[64];
  uint8_t inner[32];

  if (keylen > 64) {
    cg_sha256(key, keylen, k);
    memset(k + 32, 0, 32);
  } else {
    memcpy(k, key, keylen);
    memset(k + keylen, 0, 64 - keylen);
  }
  for (int i = 0; i < 64; i++) {
    ipad[i] = (uint8_t)(k[i] ^ 0x36);
    opad[i] = (uint8_t)(k[i] ^ 0x5c);
  }

  sha256_ctx c;
  sha256_init(&c);
  sha256_update(&c, ipad, 64);
  sha256_update(&c, data, datalen);
  sha256_final(&c, inner);

  sha256_init(&c);
  sha256_update(&c, opad, 64);
  sha256_update(&c, inner, 32);
  sha256_final(&c, out);
}

/* ---- hex helpers ------------------------------------------------------- */

void cg_hex_encode(const uint8_t *in, size_t len, char *out) {
  static const char *H = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) {
    out[i * 2] = H[(in[i] >> 4) & 0xf];
    out[i * 2 + 1] = H[in[i] & 0xf];
  }
  out[len * 2] = '\0';
}

static int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

int cg_hex_decode(const char *hex, uint8_t *out, size_t outcap) {
  size_t n = strlen(hex);
  if (n % 2 != 0) return -1;
  size_t bytes = n / 2;
  if (bytes > outcap) return -1;
  for (size_t i = 0; i < bytes; i++) {
    int hi = hexval(hex[i * 2]);
    int lo = hexval(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return -1;
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return (int)bytes;
}
