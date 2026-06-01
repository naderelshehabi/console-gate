#include "cg_test.h"
#include "cg_hmac.h"
#include "cg_sign.h"
#include <string.h>

void run_hmac_tests(void) {
  char hex[65];
  uint8_t d[32];

  /* SHA-256("abc") — FIPS 180-4 example. */
  cg_sha256((const uint8_t *)"abc", 3, d);
  cg_hex_encode(d, 32, hex);
  CHECK_STR(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  /* SHA-256("") — empty string. */
  cg_sha256((const uint8_t *)"", 0, d);
  cg_hex_encode(d, 32, hex);
  CHECK_STR(hex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

  /* HMAC-SHA256 RFC 4231 test case 2: key="Jefe", data="what do ya want for nothing?". */
  cg_hmac_sha256((const uint8_t *)"Jefe", 4, (const uint8_t *)"what do ya want for nothing?", 28, d);
  cg_hex_encode(d, 32, hex);
  CHECK_STR(hex, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");

  /* hex decode round-trip. */
  uint8_t buf[4];
  CHECK_INT(cg_hex_decode("deadbeef", buf, sizeof(buf)), 4);
  CHECK_INT(buf[0], 0xde);
  CHECK_INT(buf[3], 0xef);
  CHECK_INT(cg_hex_decode("xyz", buf, sizeof(buf)), -1);  /* bad hex */
  CHECK_INT(cg_hex_decode("abc", buf, sizeof(buf)), -1);  /* odd length */

  /* Cross-language pin: identical inputs must match the Hub's Node signer
   * (hub/src/auth/signing.ts), verified against its computed value. */
  const char *KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  cg_sha256((const uint8_t *)"{\"minutesUsedDelta\":0}", 22, d);
  cg_hex_encode(d, 32, hex);
  CHECK_STR(hex, "5ab00461e91d5d71da6702efc4bff99bed67b0b545bc562c9029544c9cb99287");

  char sig[65];
  int rc = cg_sign(KEY, "POST", "/api/v1/agent/poll", "{\"minutesUsedDelta\":0}", "n1", "1700000000000", sig);
  CHECK_INT(rc, 0);
  CHECK_STR(sig, "16470a7cbbfcb4fad91fb5d361c3e2786f88932047ddd1c76718c85dd1178374");

  /* Method is uppercased; a different body changes the signature. */
  char sig2[65];
  cg_sign(KEY, "post", "/api/v1/agent/poll", "{\"minutesUsedDelta\":0}", "n1", "1700000000000", sig2);
  CHECK_STR(sig2, sig); /* lowercase method normalises to the same signature */

  char sig3[65];
  cg_sign(KEY, "POST", "/api/v1/agent/poll", "{\"minutesUsedDelta\":1}", "n1", "1700000000000", sig3);
  CHECK(strcmp(sig3, sig) != 0);

  /* Header block embeds the nonce, ts, and the matching signature. */
  char hdr[256];
  int hn = cg_sign_request_headers(KEY, "POST", "/api/v1/agent/poll", "{\"minutesUsedDelta\":0}",
                                   "n1", "1700000000000", hdr, sizeof(hdr));
  CHECK(hn > 0);
  CHECK(strstr(hdr, "X-CG-Nonce: n1\r\n") != NULL);
  CHECK(strstr(hdr, "X-CG-Ts: 1700000000000\r\n") != NULL);
  CHECK(strstr(hdr, "X-CG-Sig: 16470a7cbbfcb4fad91fb5d361c3e2786f88932047ddd1c76718c85dd1178374\r\n") != NULL);
}
