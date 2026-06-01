#include "cg_test.h"

int cg_tests_run = 0;
int cg_tests_failed = 0;

void run_json_tests(void);
void run_proto_tests(void);
void run_agent_tests(void);
void run_enforce_tests(void);
void run_http_tests(void);
void run_hmac_tests(void);

int main(void) {
  run_json_tests();
  run_proto_tests();
  run_agent_tests();
  run_enforce_tests();
  run_http_tests();
  run_hmac_tests();
  printf("\nagent-core: %d checks, %d failed\n", cg_tests_run, cg_tests_failed);
  return cg_tests_failed ? 1 : 0;
}
