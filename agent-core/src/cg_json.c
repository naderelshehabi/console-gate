#include "cg_json.h"
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

struct cg_json {
  cg_json_type type;
  double num;
  int boolean;
  char *str;          /* STR: owned, NUL-terminated */
  cg_json **items;    /* ARR/OBJ: child values */
  char **keys;        /* OBJ: child keys (parallel to items) */
  int count;
  int cap;
};

typedef struct {
  const char *p;
  int err;
} ctx;

static cg_json *parse_value(ctx *c);

static cg_json *new_node(cg_json_type t) {
  cg_json *n = (cg_json *)calloc(1, sizeof(cg_json));
  if (n) n->type = t;
  return n;
}

static void skip_ws(ctx *c) {
  while (*c->p == ' ' || *c->p == '\t' || *c->p == '\n' || *c->p == '\r') c->p++;
}

static int append_child(cg_json *parent, char *key, cg_json *val) {
  if (parent->count == parent->cap) {
    int ncap = parent->cap ? parent->cap * 2 : 4;
    cg_json **ni = (cg_json **)realloc(parent->items, sizeof(cg_json *) * ncap);
    if (!ni) return 0;
    parent->items = ni;
    char **nk = (char **)realloc(parent->keys, sizeof(char *) * ncap);
    if (!nk) return 0;
    parent->keys = nk;
    parent->cap = ncap;
  }
  parent->keys[parent->count] = key;
  parent->items[parent->count] = val;
  parent->count++;
  return 1;
}

/* Parse a JSON string body (cursor is just past the opening quote). Returns a
 * malloc'd, unescaped, NUL-terminated string; advances cursor past closing quote. */
static char *parse_string_raw(ctx *c) {
  const char *start = c->p;
  size_t cap = 16, len = 0;
  char *out = (char *)malloc(cap);
  if (!out) { c->err = 1; return NULL; }
  while (*c->p && *c->p != '"') {
    char ch = *c->p++;
    if (ch == '\\') {
      char e = *c->p++;
      switch (e) {
        case '"': ch = '"'; break;
        case '\\': ch = '\\'; break;
        case '/': ch = '/'; break;
        case 'n': ch = '\n'; break;
        case 't': ch = '\t'; break;
        case 'r': ch = '\r'; break;
        case 'b': ch = '\b'; break;
        case 'f': ch = '\f'; break;
        case 'u': {
          /* Minimal: skip 4 hex digits, emit '?' (agents don't need unicode). */
          for (int i = 0; i < 4 && isxdigit((unsigned char)*c->p); i++) c->p++;
          ch = '?';
          break;
        }
        default: ch = e; break;
      }
    }
    if (len + 1 >= cap) {
      cap *= 2;
      char *no = (char *)realloc(out, cap);
      if (!no) { free(out); c->err = 1; return NULL; }
      out = no;
    }
    out[len++] = ch;
  }
  if (*c->p != '"') { free(out); c->err = 1; (void)start; return NULL; }
  c->p++; /* closing quote */
  out[len] = '\0';
  return out;
}

static cg_json *parse_string(ctx *c) {
  c->p++; /* opening quote */
  char *s = parse_string_raw(c);
  if (!s) return NULL;
  cg_json *n = new_node(CG_JSON_STR);
  if (!n) { free(s); c->err = 1; return NULL; }
  n->str = s;
  return n;
}

static cg_json *parse_number(ctx *c) {
  char *end = NULL;
  double v = strtod(c->p, &end);
  if (end == c->p) { c->err = 1; return NULL; }
  c->p = end;
  cg_json *n = new_node(CG_JSON_NUM);
  if (!n) { c->err = 1; return NULL; }
  n->num = v;
  return n;
}

static cg_json *parse_literal(ctx *c) {
  if (strncmp(c->p, "true", 4) == 0) {
    c->p += 4;
    cg_json *n = new_node(CG_JSON_BOOL);
    if (n) n->boolean = 1;
    return n;
  }
  if (strncmp(c->p, "false", 5) == 0) {
    c->p += 5;
    cg_json *n = new_node(CG_JSON_BOOL);
    if (n) n->boolean = 0;
    return n;
  }
  if (strncmp(c->p, "null", 4) == 0) {
    c->p += 4;
    return new_node(CG_JSON_NULL);
  }
  c->err = 1;
  return NULL;
}

static cg_json *parse_array(ctx *c) {
  c->p++; /* [ */
  cg_json *arr = new_node(CG_JSON_ARR);
  if (!arr) { c->err = 1; return NULL; }
  skip_ws(c);
  if (*c->p == ']') { c->p++; return arr; }
  for (;;) {
    skip_ws(c);
    cg_json *v = parse_value(c);
    if (!v) { cg_json_free(arr); return NULL; }
    if (!append_child(arr, NULL, v)) { cg_json_free(v); cg_json_free(arr); c->err = 1; return NULL; }
    skip_ws(c);
    if (*c->p == ',') { c->p++; continue; }
    if (*c->p == ']') { c->p++; return arr; }
    cg_json_free(arr);
    c->err = 1;
    return NULL;
  }
}

static cg_json *parse_object(ctx *c) {
  c->p++; /* { */
  cg_json *obj = new_node(CG_JSON_OBJ);
  if (!obj) { c->err = 1; return NULL; }
  skip_ws(c);
  if (*c->p == '}') { c->p++; return obj; }
  for (;;) {
    skip_ws(c);
    if (*c->p != '"') { cg_json_free(obj); c->err = 1; return NULL; }
    c->p++;
    char *key = parse_string_raw(c);
    if (!key) { cg_json_free(obj); return NULL; }
    skip_ws(c);
    if (*c->p != ':') { free(key); cg_json_free(obj); c->err = 1; return NULL; }
    c->p++;
    skip_ws(c);
    cg_json *v = parse_value(c);
    if (!v) { free(key); cg_json_free(obj); return NULL; }
    if (!append_child(obj, key, v)) { free(key); cg_json_free(v); cg_json_free(obj); c->err = 1; return NULL; }
    skip_ws(c);
    if (*c->p == ',') { c->p++; continue; }
    if (*c->p == '}') { c->p++; return obj; }
    cg_json_free(obj);
    c->err = 1;
    return NULL;
  }
}

static cg_json *parse_value(ctx *c) {
  skip_ws(c);
  char ch = *c->p;
  if (ch == '"') return parse_string(c);
  if (ch == '{') return parse_object(c);
  if (ch == '[') return parse_array(c);
  if (ch == '-' || (ch >= '0' && ch <= '9')) return parse_number(c);
  if (ch == 't' || ch == 'f' || ch == 'n') return parse_literal(c);
  c->err = 1;
  return NULL;
}

cg_json *cg_json_parse(const char *text) {
  if (!text) return NULL;
  ctx c;
  c.p = text;
  c.err = 0;
  cg_json *root = parse_value(&c);
  if (!root || c.err) {
    cg_json_free(root);
    return NULL;
  }
  skip_ws(&c);
  if (*c.p != '\0') { /* trailing garbage */
    cg_json_free(root);
    return NULL;
  }
  return root;
}

void cg_json_free(cg_json *node) {
  if (!node) return;
  if (node->str) free(node->str);
  for (int i = 0; i < node->count; i++) {
    if (node->keys && node->keys[i]) free(node->keys[i]);
    if (node->items) cg_json_free(node->items[i]);
  }
  free(node->items);
  free(node->keys);
  free(node);
}

cg_json_type cg_json_typeof(const cg_json *node) {
  return node ? node->type : CG_JSON_NULL;
}

const cg_json *cg_json_get(const cg_json *obj, const char *key) {
  if (!obj || obj->type != CG_JSON_OBJ || !key) return NULL;
  for (int i = 0; i < obj->count; i++) {
    if (obj->keys[i] && strcmp(obj->keys[i], key) == 0) return obj->items[i];
  }
  return NULL;
}

int cg_json_len(const cg_json *arr) {
  if (!arr || arr->type != CG_JSON_ARR) return 0;
  return arr->count;
}

const cg_json *cg_json_at(const cg_json *arr, int index) {
  if (!arr || arr->type != CG_JSON_ARR || index < 0 || index >= arr->count) return NULL;
  return arr->items[index];
}

double cg_json_num(const cg_json *node, double fallback) {
  return (node && node->type == CG_JSON_NUM) ? node->num : fallback;
}

int cg_json_bool(const cg_json *node, int fallback) {
  return (node && node->type == CG_JSON_BOOL) ? node->boolean : fallback;
}

const char *cg_json_str(const cg_json *node, const char *fallback) {
  return (node && node->type == CG_JSON_STR) ? node->str : fallback;
}

double cg_json_get_num(const cg_json *obj, const char *key, double fallback) {
  return cg_json_num(cg_json_get(obj, key), fallback);
}

const char *cg_json_get_str(const cg_json *obj, const char *key, const char *fallback) {
  return cg_json_str(cg_json_get(obj, key), fallback);
}
