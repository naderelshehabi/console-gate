/*
 * store.c — simple key/value persistence for the Wii agent.
 * HARDWARE LAYER (libfat over SD; a NAND-channel build persists to the title's
 * save data instead). The format is a tiny line-based file for robustness.
 */
#include "store.h"
#include <stdio.h>
#include <string.h>

#define CG_STORE_PATH "sd:/apps/consolegate/state.cfg"

int cg_store_load(cg_store *s) {
  memset(s, 0, sizeof(*s));
  s->hub_port = 8088;
  FILE *f = fopen(CG_STORE_PATH, "r");
  if (!f) return 0;
  char line[128];
  while (fgets(line, sizeof(line), f)) {
    char *eq = strchr(line, '=');
    if (!eq) continue;
    *eq = '\0';
    char *key = line;
    char *val = eq + 1;
    char *nl = strpbrk(val, "\r\n");
    if (nl) *nl = '\0';
    if (strcmp(key, "token") == 0) {
      strncpy(s->device_token, val, sizeof(s->device_token) - 1);
    } else if (strcmp(key, "host") == 0) {
      strncpy(s->hub_host, val, sizeof(s->hub_host) - 1);
    } else if (strcmp(key, "port") == 0) {
      s->hub_port = atoi(val);
    } else if (strcmp(key, "highwater") == 0) {
      s->high_water_utc_ms = (int64_t)strtoll(val, NULL, 10);
    }
  }
  fclose(f);
  return 1;
}

int cg_store_save(const cg_store *s) {
  FILE *f = fopen(CG_STORE_PATH, "w");
  if (!f) return -1;
  fprintf(f, "token=%s\n", s->device_token);
  fprintf(f, "host=%s\n", s->hub_host);
  fprintf(f, "port=%d\n", s->hub_port);
  fprintf(f, "highwater=%lld\n", (long long)s->high_water_utc_ms);
  fclose(f);
  return 0;
}
