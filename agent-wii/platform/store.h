/*
 * store.h — persist the agent's device token + high-water mark on the Wii.
 * Stored on SD/NAND so a power-cycle can't grant time (high-water survives) and
 * the agent stays paired. Hardware layer (libfat); host build stubs it out.
 */
#ifndef CG_WII_STORE_H
#define CG_WII_STORE_H

#include <stdint.h>

typedef struct {
  char device_token[64];
  char hub_host[16];
  int hub_port;
  int64_t high_water_utc_ms;
} cg_store;

/* Load persisted state. Returns 1 if a store existed, 0 if fresh. */
int cg_store_load(cg_store *s);

/* Persist state. Returns 0 on success. */
int cg_store_save(const cg_store *s);

#endif /* CG_WII_STORE_H */
