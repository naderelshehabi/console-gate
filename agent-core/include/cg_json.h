/*
 * cg_json — a small, dependency-free JSON reader for the ConsoleGate agents.
 *
 * Sufficient for parsing the Hub's API responses (objects, arrays, strings,
 * numbers, booleans, null, nesting). Portable C99 — no platform dependencies —
 * so it compiles for the host (tests) and for the Wii/360 (devkitPPC/XDK).
 */
#ifndef CG_JSON_H
#define CG_JSON_H

typedef enum {
  CG_JSON_NULL,
  CG_JSON_BOOL,
  CG_JSON_NUM,
  CG_JSON_STR,
  CG_JSON_ARR,
  CG_JSON_OBJ
} cg_json_type;

typedef struct cg_json cg_json;

/* Parse a NUL-terminated JSON document. Returns NULL on malformed input.
 * The caller owns the result and must cg_json_free() it. */
cg_json *cg_json_parse(const char *text);
void cg_json_free(cg_json *node);

cg_json_type cg_json_typeof(const cg_json *node);

/* Object field lookup by key. Returns NULL if not an object or key absent. */
const cg_json *cg_json_get(const cg_json *obj, const char *key);

/* Array access. cg_json_len returns 0 for non-arrays. */
int cg_json_len(const cg_json *arr);
const cg_json *cg_json_at(const cg_json *arr, int index);

/* Typed accessors with defaults when the node is NULL or the wrong type. */
double cg_json_num(const cg_json *node, double fallback);
int cg_json_bool(const cg_json *node, int fallback);
const char *cg_json_str(const cg_json *node, const char *fallback);

/* Convenience: get an object field's number/string in one call. */
double cg_json_get_num(const cg_json *obj, const char *key, double fallback);
const char *cg_json_get_str(const cg_json *obj, const char *key, const char *fallback);

#endif /* CG_JSON_H */
