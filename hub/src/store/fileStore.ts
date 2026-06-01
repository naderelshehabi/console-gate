import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Store } from './store';
import { uuid } from '../util/ids';
import { WEEKDAYS } from '../types';
import type {
  Console,
  Schedule,
  DaySchedule,
  Flags,
  Grant,
  QuotaState,
  Session,
  Device,
  Command,
  MoreTimeRequest,
  PinRecord,
  RequestStatus,
  Weekday,
} from '../types';

interface StateDoc {
  version: 1;
  hubId: string;
  pin: PinRecord | null;
  consoles: Console[];
  schedules: Schedule[];
  flags: Flags[];
  grants: Grant[];
  quotaStates: QuotaState[];
  sessions: Session[];
  devices: Device[];
  commands: Command[];
  requests: MoreTimeRequest[];
}

function defaultDays(): Record<Weekday, DaySchedule> {
  const day: DaySchedule = { windows: [{ start: '08:00', end: '21:00' }], quotaMin: 120 };
  const out = {} as Record<Weekday, DaySchedule>;
  for (const d of WEEKDAYS) out[d] = { windows: day.windows.map((w) => ({ ...w })), quotaMin: day.quotaMin };
  return out;
}

/**
 * File-backed Store. Holds all state (except the append-only event log) in a
 * single JSON document persisted atomically (temp file + rename). Writes are
 * serialized through a promise chain so concurrent async mutations never
 * interleave a half-written file. Appropriate for a Hub managing a handful of
 * consoles; the {@link Store} interface lets a SQLite backend replace it later.
 */
export class FileStore implements Store {
  private doc: StateDoc;
  private readonly statePath: string;
  private readonly secretPath: string;
  private readonly secret: Buffer;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(dataDir: string, doc: StateDoc, secret: Buffer) {
    this.statePath = join(dataDir, 'state.json');
    this.secretPath = join(dataDir, 'hub.secret');
    this.doc = doc;
    this.secret = secret;
  }

  static open(dataDir: string, tz = 'UTC'): FileStore {
    mkdirSync(dataDir, { recursive: true });
    const statePath = join(dataDir, 'state.json');
    const secretPath = join(dataDir, 'hub.secret');

    let secret: Buffer;
    if (existsSync(secretPath)) {
      secret = Buffer.from(readFileSync(secretPath, 'utf8').trim(), 'hex');
    } else {
      secret = randomBytes(32);
      writeFileSync(secretPath, secret.toString('hex'), { mode: 0o600 });
    }

    let doc: StateDoc;
    if (existsSync(statePath)) {
      doc = JSON.parse(readFileSync(statePath, 'utf8')) as StateDoc;
    } else {
      doc = {
        version: 1,
        hubId: uuid(),
        pin: null,
        consoles: [],
        schedules: [
          { consoleId: null, days: defaultDays(), tz, updatedAt: Date.now(), updatedBy: 'seed' },
        ],
        flags: [],
        grants: [],
        quotaStates: [],
        sessions: [],
        devices: [],
        commands: [],
        requests: [],
      };
      writeFileSync(statePath, JSON.stringify(doc, null, 2));
    }
    return new FileStore(dataDir, doc, secret);
  }

  private persist(): Promise<void> {
    // Serialize writes; snapshot is taken at write time inside the chain.
    this.writeChain = this.writeChain.then(() => {
      const tmp = `${this.statePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.doc, null, 2));
      renameSync(tmp, this.statePath);
    });
    return this.writeChain;
  }

  // Meta -------------------------------------------------------------------
  getHubId(): string {
    return this.doc.hubId;
  }
  getPinRecord(): PinRecord | null {
    return this.doc.pin;
  }
  setPinRecord(rec: PinRecord): Promise<void> {
    this.doc.pin = rec;
    return this.persist();
  }
  getSecret(): Buffer {
    return this.secret;
  }

  // Consoles ---------------------------------------------------------------
  getConsole(id: string): Console | undefined {
    return this.doc.consoles.find((c) => c.id === id);
  }
  listConsoles(): Console[] {
    return [...this.doc.consoles];
  }
  upsertConsole(c: Console): Promise<void> {
    const i = this.doc.consoles.findIndex((x) => x.id === c.id);
    if (i >= 0) this.doc.consoles[i] = c;
    else this.doc.consoles.push(c);
    return this.persist();
  }

  // Schedules --------------------------------------------------------------
  getSchedule(consoleId: string): Schedule | undefined {
    return this.doc.schedules.find((s) => s.consoleId === consoleId);
  }
  getDefaultSchedule(): Schedule {
    const def = this.doc.schedules.find((s) => s.consoleId === null);
    if (!def) throw new Error('default schedule missing');
    return def;
  }
  upsertSchedule(s: Schedule): Promise<void> {
    const i = this.doc.schedules.findIndex((x) => x.consoleId === s.consoleId);
    if (i >= 0) this.doc.schedules[i] = s;
    else this.doc.schedules.push(s);
    return this.persist();
  }

  // Flags ------------------------------------------------------------------
  getFlags(consoleId: string): Flags | undefined {
    return this.doc.flags.find((f) => f.consoleId === consoleId);
  }
  upsertFlags(f: Flags): Promise<void> {
    const i = this.doc.flags.findIndex((x) => x.consoleId === f.consoleId);
    if (i >= 0) this.doc.flags[i] = f;
    else this.doc.flags.push(f);
    return this.persist();
  }

  // Grants -----------------------------------------------------------------
  listGrants(consoleId: string, date: string): Grant[] {
    return this.doc.grants.filter((g) => g.consoleId === consoleId && g.date === date);
  }
  addGrant(g: Grant): Promise<void> {
    this.doc.grants.push(g);
    return this.persist();
  }

  // Quota ------------------------------------------------------------------
  getQuota(consoleId: string, date: string): QuotaState | undefined {
    return this.doc.quotaStates.find((q) => q.consoleId === consoleId && q.date === date);
  }
  listQuota(consoleId: string): QuotaState[] {
    return this.doc.quotaStates.filter((q) => q.consoleId === consoleId);
  }
  upsertQuota(q: QuotaState): Promise<void> {
    const i = this.doc.quotaStates.findIndex((x) => x.consoleId === q.consoleId && x.date === q.date);
    if (i >= 0) this.doc.quotaStates[i] = q;
    else this.doc.quotaStates.push(q);
    return this.persist();
  }

  // Sessions ---------------------------------------------------------------
  getSession(id: string): Session | undefined {
    return this.doc.sessions.find((s) => s.id === id);
  }
  listOpenSessions(consoleId: string): Session[] {
    return this.doc.sessions.filter((s) => s.consoleId === consoleId && s.endedUtc === null);
  }
  addSession(s: Session): Promise<void> {
    this.doc.sessions.push(s);
    return this.persist();
  }
  updateSession(s: Session): Promise<void> {
    const i = this.doc.sessions.findIndex((x) => x.id === s.id);
    if (i >= 0) this.doc.sessions[i] = s;
    else this.doc.sessions.push(s);
    return this.persist();
  }

  // Devices ----------------------------------------------------------------
  getDevice(id: string): Device | undefined {
    return this.doc.devices.find((d) => d.id === id);
  }
  getDeviceByTokenHash(hash: string): Device | undefined {
    return this.doc.devices.find((d) => d.tokenHash === hash);
  }
  listDevices(): Device[] {
    return [...this.doc.devices];
  }
  upsertDevice(d: Device): Promise<void> {
    const i = this.doc.devices.findIndex((x) => x.id === d.id);
    if (i >= 0) this.doc.devices[i] = d;
    else this.doc.devices.push(d);
    return this.persist();
  }
  deleteDevice(id: string): Promise<void> {
    this.doc.devices = this.doc.devices.filter((d) => d.id !== id);
    return this.persist();
  }

  // Commands ---------------------------------------------------------------
  listCommands(consoleId: string): Command[] {
    return this.doc.commands.filter((c) => c.consoleId === consoleId);
  }
  addCommand(c: Command): Promise<void> {
    this.doc.commands.push(c);
    return this.persist();
  }
  removeCommand(id: string): Promise<void> {
    this.doc.commands = this.doc.commands.filter((c) => c.id !== id);
    return this.persist();
  }

  // Requests ---------------------------------------------------------------
  listRequests(status?: RequestStatus): MoreTimeRequest[] {
    return this.doc.requests.filter((r) => (status ? r.status === status : true));
  }
  getRequest(id: string): MoreTimeRequest | undefined {
    return this.doc.requests.find((r) => r.id === id);
  }
  addRequest(r: MoreTimeRequest): Promise<void> {
    this.doc.requests.push(r);
    return this.persist();
  }
  updateRequest(r: MoreTimeRequest): Promise<void> {
    const i = this.doc.requests.findIndex((x) => x.id === r.id);
    if (i >= 0) this.doc.requests[i] = r;
    return this.persist();
  }
}
