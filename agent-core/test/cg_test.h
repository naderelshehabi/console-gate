/* Minimal C test harness for agent-core (host gcc). */
#ifndef CG_TEST_H
#define CG_TEST_H
#include <stdio.h>
#include <string.h>

extern int cg_tests_run;
extern int cg_tests_failed;

#define CHECK(cond)                                                            \
  do {                                                                         \
    cg_tests_run++;                                                            \
    if (!(cond)) {                                                             \
      cg_tests_failed++;                                                       \
      printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                   \
    }                                                                          \
  } while (0)

#define CHECK_INT(a, b)                                                        \
  do {                                                                         \
    cg_tests_run++;                                                            \
    long _a = (long)(a), _b = (long)(b);                                       \
    if (_a != _b) {                                                            \
      cg_tests_failed++;                                                       \
      printf("FAIL %s:%d: %s == %ld, expected %ld\n", __FILE__, __LINE__, #a,  \
             _a, _b);                                                          \
    }                                                                          \
  } while (0)

#define CHECK_STR(a, b)                                                        \
  do {                                                                         \
    cg_tests_run++;                                                            \
    if (strcmp((a), (b)) != 0) {                                               \
      cg_tests_failed++;                                                       \
      printf("FAIL %s:%d: %s == \"%s\", expected \"%s\"\n", __FILE__,          \
             __LINE__, #a, (a), (b));                                          \
    }                                                                          \
  } while (0)

#endif
