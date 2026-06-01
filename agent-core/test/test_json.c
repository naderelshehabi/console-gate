#include "cg_test.h"
#include "cg_json.h"

void run_json_tests(void) {
  /* Object with mixed value types + nesting. */
  const char *doc =
      "{\"a\":1,\"b\":\"hi\",\"c\":true,\"d\":null,"
      "\"arr\":[1,2,3],\"obj\":{\"x\":-4.5}}";
  cg_json *root = cg_json_parse(doc);
  CHECK(root != NULL);
  CHECK_INT(cg_json_typeof(root), CG_JSON_OBJ);
  CHECK_INT((long)cg_json_get_num(root, "a", -1), 1);
  CHECK_STR(cg_json_get_str(root, "b", ""), "hi");
  CHECK_INT(cg_json_bool(cg_json_get(root, "c"), 0), 1);
  CHECK_INT(cg_json_typeof(cg_json_get(root, "d")), CG_JSON_NULL);

  const cg_json *arr = cg_json_get(root, "arr");
  CHECK_INT(cg_json_len(arr), 3);
  CHECK_INT((long)cg_json_num(cg_json_at(arr, 1), 0), 2);

  const cg_json *obj = cg_json_get(root, "obj");
  CHECK(cg_json_get_num(obj, "x", 0) < -4.0 && cg_json_get_num(obj, "x", 0) > -5.0);

  /* Missing key returns NULL and falls back. */
  CHECK(cg_json_get(root, "nope") == NULL);
  CHECK_INT((long)cg_json_get_num(root, "nope", 42), 42);
  cg_json_free(root);

  /* String escapes. */
  cg_json *s = cg_json_parse("\"line1\\nline2\\t\\\"q\\\"\"");
  CHECK(s != NULL);
  CHECK_STR(cg_json_str(s, ""), "line1\nline2\t\"q\"");
  cg_json_free(s);

  /* Top-level array and number. */
  cg_json *a = cg_json_parse("[10, 20]");
  CHECK_INT(cg_json_len(a), 2);
  cg_json_free(a);

  /* Malformed inputs return NULL. */
  CHECK(cg_json_parse("{") == NULL);
  CHECK(cg_json_parse("{\"a\":}") == NULL);
  CHECK(cg_json_parse("[1,2") == NULL);
  CHECK(cg_json_parse("{\"a\":1} trailing") == NULL);
  CHECK(cg_json_parse("") == NULL);
  CHECK(cg_json_parse(NULL) == NULL);
}
