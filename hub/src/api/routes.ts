import { z } from 'zod';
import { Router, HttpError, type Ctx } from './http';
import type { Hub } from '../hub';
import { AuthError, LockedOutError, ValidationError } from '../auth/authService';
import { defaultFlags } from '../policy/defaults';
import { isValidWindow } from '../policy/schedule';
import { assertValidTimezone } from '../util/localtime';
import { isEventType } from '../events/taxonomy';
import { computeSummary } from '../analytics/analytics';
import { uuid } from '../util/ids';
import { WEEKDAYS } from '../types';
import type { Console, Device, EffectiveState, Flags, Schedule } from '../types';

const API = '/api/v1';

// ---- middleware helpers ----------------------------------------------------

function bearer(ctx: Ctx): string | undefined {
  const h = ctx.header('authorization');
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : undefined;
}

function requireDevice(ctx: Ctx, hub: Hub): Device {
  const device = hub.auth.authenticate(bearer(ctx));
  if (!device) throw new HttpError(401, 'invalid or missing device token');
  return device;
}

function requireAgent(ctx: Ctx, hub: Hub): { device: Device; consoleId: string; console: Console } {
  const device = requireDevice(ctx, hub);
  if (device.kind !== 'agent' || !device.consoleId) throw new HttpError(403, 'agent device required');
  const console = hub.store.getConsole(device.consoleId);
  if (!console) throw new HttpError(404, 'console not found');
  return { device, consoleId: device.consoleId, console };
}

function requirePin(ctx: Ctx, hub: Hub): void {
  if (!hub.auth.isPinSet()) throw new HttpError(409, 'parent PIN not configured');
  const pin = ctx.header('x-parent-pin');
  if (pin !== undefined) {
    let ok: boolean;
    try {
      ok = hub.auth.verifyPin(pin);
    } catch (e) {
      if (e instanceof LockedOutError) throw new HttpError(429, e.message);
      throw e;
    }
    if (!ok) throw new HttpError(401, 'invalid PIN');
    return;
  }
  if (hub.auth.verifyPinSession(ctx.header('x-pin-session'))) return;
  throw new HttpError(403, 'parent PIN required');
}

function actorOf(device: Device): string {
  return `${device.kind}:${device.name}`;
}

function effectiveResponse(e: EffectiveState) {
  return {
    state: e.state,
    reason: e.reason,
    secondsToNextBoundary: e.secondsToNextBoundary,
    quotaRemainingMin: e.quotaRemainingMin,
    warnThresholdsMin: e.warnThresholdsMin,
    graceSeconds: e.graceSeconds,
    enforcement: e.enforcement,
  };
}

function body<T>(ctx: Ctx, schema: z.ZodType<T>): T {
  return schema.parse(ctx.body ?? {});
}

// ---- validation schemas ----------------------------------------------------

const windowSchema = z.object({ start: z.string(), end: z.string() });
const daySchema = z.object({ windows: z.array(windowSchema), quotaMin: z.number().int().min(0).max(1440) });
const daysSchema = z.object({
  mon: daySchema,
  tue: daySchema,
  wed: daySchema,
  thu: daySchema,
  fri: daySchema,
  sat: daySchema,
  sun: daySchema,
});

// ---- route registration ----------------------------------------------------

export function registerRoutes(router: Router, hub: Hub): void {
  // System -------------------------------------------------------------------
  router.get(`${API}/hello`, (ctx) => {
    const device = hub.auth.authenticate(bearer(ctx));
    const out: Record<string, unknown> = { hubId: hub.store.getHubId(), serverTime: hub.time.status() };
    if (device?.kind === 'agent' && device.consoleId) {
      out.yourConsole = hub.store.getConsole(device.consoleId) ?? null;
    }
    ctx.json(200, out);
  });

  router.get(`${API}/time`, (ctx) => {
    ctx.json(200, hub.time.status());
  });

  router.post(`${API}/time/refresh`, async (ctx) => {
    requirePin(ctx, hub);
    const status = await hub.time.refresh();
    hub.events.emit({ type: 'TIME_RESYNCED', data: { source: status.source }, ts: hub.time.now() });
    ctx.json(200, status);
  });

  router.get(`${API}/system/verify-log`, (ctx) => {
    requirePin(ctx, hub);
    ctx.json(200, hub.events.verify());
  });

  // Setup / PIN --------------------------------------------------------------
  router.get(`${API}/setup`, (ctx) => {
    ctx.json(200, { pinSet: hub.auth.isPinSet(), hubId: hub.store.getHubId() });
  });

  router.post(`${API}/setup/pin`, async (ctx) => {
    const b = body(ctx, z.object({ pin: z.string(), oldPin: z.string().optional() }));
    // Changing an existing PIN requires the old one; the AuthService enforces it.
    await hub.auth.setPin(b.pin, b.oldPin);
    ctx.json(200, { ok: true });
  });

  router.post(`${API}/pin/verify`, (ctx) => {
    const b = body(ctx, z.object({ pin: z.string() }));
    const session = hub.auth.createPinSession(b.pin);
    ctx.json(200, { ok: true, pinSession: session.token, expires: session.expires });
  });

  // Web UI login: PIN -> a web device token (for reads) + a PIN session (for mutations).
  router.post(`${API}/web/login`, async (ctx) => {
    const b = body(ctx, z.object({ pin: z.string() }));
    if (!hub.auth.isPinSet()) throw new HttpError(409, 'parent PIN not configured');
    let session: { token: string; expires: number };
    try {
      session = hub.auth.createPinSession(b.pin);
    } catch (e) {
      if (e instanceof LockedOutError) throw new HttpError(429, e.message);
      if (e instanceof AuthError) throw new HttpError(401, e.message);
      throw e;
    }
    const { token } = await hub.auth.ensureWebDevice('Web UI');
    ctx.json(200, { deviceToken: token, pinSession: session.token, expires: session.expires });
  });

  // Pairing ------------------------------------------------------------------
  router.post(`${API}/pair/start`, (ctx) => {
    requirePin(ctx, hub);
    ctx.json(200, hub.auth.startPairing());
  });

  router.post(`${API}/pair/claim`, async (ctx) => {
    const b = body(
      ctx,
      z.object({
        code: z.string(),
        deviceKind: z.enum(['agent', 'web', 'android']),
        deviceName: z.string().min(1),
        pushToken: z.string().nullish(),
        consoleKind: z.enum(['xbox360', 'wii']).optional(),
        consoleName: z.string().optional(),
      }),
    );
    const result = await hub.auth.claimPairing(b.code, {
      deviceKind: b.deviceKind,
      deviceName: b.deviceName,
      pushToken: b.pushToken ?? null,
      consoleKind: b.consoleKind,
      consoleName: b.consoleName,
    });
    ctx.json(200, { deviceId: result.device.id, deviceToken: result.token, console: result.console ?? null });
  });

  // Agent --------------------------------------------------------------------
  router.post(`${API}/agent/poll`, async (ctx) => {
    const { device, consoleId, console } = requireAgent(ctx, hub);
    const b = body(
      ctx,
      z.object({
        localUtcGuess: z.number().optional(),
        monoTicks: z.number().optional(),
        minutesUsedDelta: z.number().min(0).optional(),
        state: z.string().optional(),
        currentTitleId: z.string().nullish(),
        agentVersion: z.string().optional(),
      }),
    );
    const now = hub.time.now();
    const schedule = hub.enforcement.effectiveSchedule(consoleId);

    // Capture the pre-advance high-water for backward-clock detection, then advance it.
    const qBefore = await hub.quota.ensure(consoleId, schedule, now);
    const signal = hub.enforcement.buildTimeSignal(qBefore.highWaterUtc, b.localUtcGuess);

    const delta = b.minutesUsedDelta ?? 0;
    if (delta > 0) await hub.quota.applyUsage(consoleId, schedule, delta, now);
    else await hub.quota.bumpHighWater(consoleId, schedule, now);

    // Touch liveness.
    await hub.store.upsertConsole({
      ...console,
      lastSeen: now,
      agentVersion: b.agentVersion ?? console.agentVersion,
    });
    await hub.store.upsertDevice({ ...device, lastSeen: now });

    const computed = await hub.enforcement.computeState(consoleId, signal);
    hub.enforcement.recordTransition(consoleId, computed.effective, now);

    const commands = hub.store.listCommands(consoleId);
    ctx.json(200, {
      authoritative: hub.time.status(),
      effective: effectiveResponse(computed.effective),
      commands,
    });
  });

  router.post(`${API}/agent/heartbeat`, async (ctx) => {
    const { device, console } = requireAgent(ctx, hub);
    const now = hub.time.now();
    await hub.store.upsertConsole({ ...console, lastSeen: now });
    await hub.store.upsertDevice({ ...device, lastSeen: now });
    ctx.json(200, { ok: true, serverTime: hub.time.now() });
  });

  router.post(`${API}/agent/session/start`, async (ctx) => {
    const { consoleId, console } = requireAgent(ctx, hub);
    const b = body(
      ctx,
      z.object({
        titleId: z.string().nullish(),
        expectedReturnBy: z.number().nullish(),
        source: z.enum(['360-live', 'wii-gate']).optional(),
      }),
    );
    const now = hub.time.now();
    const id = uuid();
    await hub.store.addSession({
      id,
      consoleId,
      startedUtc: now,
      endedUtc: null,
      titleId: b.titleId ?? null,
      expectedReturnBy: b.expectedReturnBy ?? null,
      source: b.source ?? (console.kind === 'wii' ? 'wii-gate' : '360-live'),
    });
    hub.events.emit({ type: 'SESSION_START', consoleId, data: { titleId: b.titleId ?? null }, ts: now });
    ctx.json(200, { sessionId: id });
  });

  router.post(`${API}/agent/session/end`, async (ctx) => {
    const { consoleId } = requireAgent(ctx, hub);
    const b = body(
      ctx,
      z.object({
        sessionId: z.string(),
        elapsedMin: z.number().min(0),
        overageMin: z.number().min(0).optional(),
      }),
    );
    const now = hub.time.now();
    const session = hub.store.getSession(b.sessionId);
    if (!session || session.consoleId !== consoleId) throw new HttpError(404, 'session not found');
    const schedule = hub.enforcement.effectiveSchedule(consoleId);
    await hub.quota.applyUsage(consoleId, schedule, b.elapsedMin, now);
    await hub.store.updateSession({ ...session, endedUtc: now });
    hub.events.emit({ type: 'SESSION_END', consoleId, data: { elapsedMin: b.elapsedMin }, ts: now });
    if (b.overageMin && b.overageMin > 0) {
      hub.events.emit({ type: 'PLAY_BEYOND_DOWNTIME', consoleId, data: { overageMin: b.overageMin }, ts: now });
    }
    ctx.json(200, { ok: true });
  });

  router.post(`${API}/agent/events`, (ctx) => {
    const { consoleId } = requireAgent(ctx, hub);
    const events = z
      .array(z.object({ type: z.string(), data: z.record(z.unknown()).optional(), ts: z.number().optional() }))
      .parse(ctx.body ?? []);
    let accepted = 0;
    for (const e of events) {
      if (!isEventType(e.type)) continue;
      hub.events.emit({ type: e.type, consoleId, data: e.data ?? {}, ts: e.ts ?? hub.time.now() });
      accepted++;
    }
    ctx.json(200, { accepted });
  });

  router.post(`${API}/agent/command/ack`, async (ctx) => {
    requireAgent(ctx, hub);
    const b = body(ctx, z.object({ commandId: z.string() }));
    await hub.store.removeCommand(b.commandId);
    ctx.json(200, { ok: true });
  });

  router.post(`${API}/unlock/verify`, async (ctx) => {
    const { consoleId } = requireAgent(ctx, hub);
    const b = body(ctx, z.object({ pin: z.string() }));
    if (!hub.auth.isPinSet()) throw new HttpError(409, 'parent PIN not configured');
    let ok: boolean;
    try {
      ok = hub.auth.verifyPin(b.pin);
    } catch (e) {
      if (e instanceof LockedOutError) throw new HttpError(429, e.message);
      throw e;
    }
    if (ok) await hub.control.unlock(consoleId, 'console-pin');
    ctx.json(ok ? 200 : 401, { ok });
  });

  // Controller: reads --------------------------------------------------------
  router.get(`${API}/consoles`, async (ctx) => {
    requireDevice(ctx, hub);
    const consoles = hub.store.listConsoles();
    const out = [];
    for (const c of consoles) {
      const computed = await hub.enforcement.computeState(c.id);
      out.push({ console: c, effective: effectiveResponse(computed.effective), quota: computed.quota });
    }
    ctx.json(200, { consoles: out });
  });

  router.get(`${API}/consoles/:id`, async (ctx) => {
    requireDevice(ctx, hub);
    const c = hub.store.getConsole(ctx.params.id!);
    if (!c) throw new HttpError(404, 'console not found');
    const computed = await hub.enforcement.computeState(c.id);
    ctx.json(200, {
      console: c,
      effective: effectiveResponse(computed.effective),
      quota: computed.quota,
      flags: computed.flags,
      schedule: computed.schedule,
    });
  });

  router.get(`${API}/schedule/:consoleId`, (ctx) => {
    requireDevice(ctx, hub);
    ctx.json(200, hub.enforcement.effectiveSchedule(ctx.params.consoleId!));
  });

  router.put(`${API}/schedule/:consoleId`, async (ctx) => {
    requirePin(ctx, hub);
    const consoleId = ctx.params.consoleId!;
    if (!hub.store.getConsole(consoleId)) throw new HttpError(404, 'console not found');
    const b = body(ctx, z.object({ days: daysSchema, tz: z.string() }));
    assertValidTimezone(b.tz);
    for (const d of WEEKDAYS) {
      for (const w of b.days[d].windows) {
        if (!isValidWindow(w)) throw new HttpError(400, `invalid window on ${d}: ${w.start}-${w.end}`);
      }
    }
    const schedule: Schedule = {
      consoleId,
      days: b.days,
      tz: b.tz,
      updatedAt: hub.time.now(),
      updatedBy: actorOf(requireDevice(ctx, hub)),
    };
    await hub.store.upsertSchedule(schedule);
    ctx.json(200, schedule);
  });

  router.get(`${API}/flags/:consoleId`, (ctx) => {
    requireDevice(ctx, hub);
    const consoleId = ctx.params.consoleId!;
    ctx.json(200, hub.store.getFlags(consoleId) ?? defaultFlags(consoleId));
  });

  router.put(`${API}/flags/:consoleId`, async (ctx) => {
    requirePin(ctx, hub);
    const consoleId = ctx.params.consoleId!;
    if (!hub.store.getConsole(consoleId)) throw new HttpError(404, 'console not found');
    const b = body(
      ctx,
      z.object({
        enforcement: z.enum(['soft', 'hard']).optional(),
        warnThresholdsMin: z.array(z.number().int().min(0)).optional(),
        graceSeconds: z.number().int().min(0).max(3600).optional(),
        wiiMinSessionMin: z.number().int().min(0).optional(),
        wiiBlockUnfinishable: z.boolean().optional(),
      }),
    );
    const current = hub.store.getFlags(consoleId) ?? defaultFlags(consoleId);
    const updated: Flags = {
      ...current,
      ...(b.enforcement !== undefined ? { enforcement: b.enforcement } : {}),
      ...(b.warnThresholdsMin !== undefined ? { warnThresholdsMin: b.warnThresholdsMin } : {}),
      ...(b.graceSeconds !== undefined ? { graceSeconds: b.graceSeconds } : {}),
      ...(b.wiiMinSessionMin !== undefined ? { wiiMinSessionMin: b.wiiMinSessionMin } : {}),
      ...(b.wiiBlockUnfinishable !== undefined ? { wiiBlockUnfinishable: b.wiiBlockUnfinishable } : {}),
    };
    await hub.store.upsertFlags(updated);
    ctx.json(200, updated);
  });

  // Controller: actions ------------------------------------------------------
  const requireConsole = (id: string): Console => {
    const c = hub.store.getConsole(id);
    if (!c) throw new HttpError(404, 'console not found');
    return c;
  };

  router.post(`${API}/consoles/:id/grant`, async (ctx) => {
    requirePin(ctx, hub);
    const c = requireConsole(ctx.params.id!);
    const b = body(ctx, z.object({ minutes: z.number().int().min(1).max(1440) }));
    await hub.control.grantBonus(c.id, b.minutes, actorOf(requireDevice(ctx, hub)));
    ctx.json(200, { ok: true });
  });

  router.post(`${API}/consoles/:id/extend-today`, async (ctx) => {
    requirePin(ctx, hub);
    const c = requireConsole(ctx.params.id!);
    const b = body(ctx, z.object({ minutes: z.number().int().min(1).max(1440) }));
    await hub.control.grantBonus(c.id, b.minutes, actorOf(requireDevice(ctx, hub)), true);
    ctx.json(200, { ok: true });
  });

  router.post(`${API}/consoles/:id/lock`, async (ctx) => {
    requirePin(ctx, hub);
    const c = requireConsole(ctx.params.id!);
    await hub.control.lockNow(c.id, actorOf(requireDevice(ctx, hub)));
    ctx.json(200, { ok: true });
  });

  router.post(`${API}/consoles/:id/unlock`, async (ctx) => {
    requirePin(ctx, hub);
    const c = requireConsole(ctx.params.id!);
    await hub.control.unlock(c.id, actorOf(requireDevice(ctx, hub)));
    ctx.json(200, { ok: true });
  });

  router.post(`${API}/consoles/:id/pause`, async (ctx) => {
    requirePin(ctx, hub);
    const c = requireConsole(ctx.params.id!);
    await hub.control.pause(c.id, actorOf(requireDevice(ctx, hub)));
    ctx.json(200, { ok: true });
  });

  router.post(`${API}/consoles/:id/resume`, async (ctx) => {
    requirePin(ctx, hub);
    const c = requireConsole(ctx.params.id!);
    await hub.control.resume(c.id, actorOf(requireDevice(ctx, hub)));
    ctx.json(200, { ok: true });
  });

  // Requests -----------------------------------------------------------------
  router.post(`${API}/consoles/:id/request-time`, async (ctx) => {
    requireAgent(ctx, hub);
    const c = requireConsole(ctx.params.id!);
    const b = body(ctx, z.object({ minutes: z.number().int().min(1).max(240), reason: z.string().nullish() }));
    const req = await hub.control.requestMoreTime(c.id, b.minutes, b.reason ?? null);
    ctx.json(200, { request: req });
  });

  router.get(`${API}/requests`, (ctx) => {
    requireDevice(ctx, hub);
    const status = ctx.query.get('status') as 'pending' | 'approved' | 'denied' | null;
    ctx.json(200, { requests: hub.store.listRequests(status ?? undefined) });
  });

  router.post(`${API}/requests/:id/approve`, async (ctx) => {
    requirePin(ctx, hub);
    const req = await hub.control.approveRequest(ctx.params.id!, actorOf(requireDevice(ctx, hub)));
    ctx.json(200, { request: req });
  });

  router.post(`${API}/requests/:id/deny`, async (ctx) => {
    requirePin(ctx, hub);
    const req = await hub.control.denyRequest(ctx.params.id!, actorOf(requireDevice(ctx, hub)));
    ctx.json(200, { request: req });
  });

  // Events & analytics -------------------------------------------------------
  router.get(`${API}/events`, (ctx) => {
    requireDevice(ctx, hub);
    const since = ctx.query.get('since');
    const type = ctx.query.get('type');
    const consoleId = ctx.query.get('consoleId');
    const limit = ctx.query.get('limit');
    ctx.json(200, {
      events: hub.events.query({
        since: since ? Number(since) : undefined,
        type: type && isEventType(type) ? type : undefined,
        consoleId: consoleId ?? undefined,
        limit: limit ? Number(limit) : 200,
      }),
    });
  });

  router.get(`${API}/analytics/summary`, (ctx) => {
    requireDevice(ctx, hub);
    const now = hub.time.now();
    const days = Number(ctx.query.get('days') ?? '30');
    const sinceTs = now - (Number.isFinite(days) ? days : 30) * 86_400_000;
    ctx.json(200, computeSummary(hub.store, hub.events, { sinceTs, now, maxDays: Number.isFinite(days) ? days : 30 }));
  });
}

/** Map known service errors to HTTP statuses. */
export function statusForError(err: unknown): { status: number; message: string } {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  if (err instanceof LockedOutError) return { status: 429, message: err.message };
  if (err instanceof AuthError) return { status: 401, message: err.message };
  if (err instanceof ValidationError) return { status: 400, message: err.message };
  if (err instanceof z.ZodError) return { status: 400, message: 'validation: ' + err.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ') };
  return { status: 500, message: 'internal error' };
}
