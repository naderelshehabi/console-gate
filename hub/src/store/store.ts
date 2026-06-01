import type {
  Console,
  Schedule,
  Flags,
  Grant,
  QuotaState,
  Session,
  Device,
  Command,
  MoreTimeRequest,
  PinRecord,
  RequestStatus,
} from '../types';

/**
 * Persistence boundary. The Hub depends only on this interface, so the
 * file-backed implementation can be replaced by SQLite later without touching
 * the services. All mutating methods are async to allow durable backends.
 */
export interface Store {
  // Meta
  getHubId(): string;
  getPinRecord(): PinRecord | null;
  setPinRecord(rec: PinRecord): Promise<void>;
  getSecret(): Buffer; // HMAC key for the signed event log

  // Replication / backup
  exportState(): unknown;             // a deep, serializable snapshot of all state
  importState(doc: unknown): Promise<void>; // replace state (standby read-replica)

  // Consoles
  getConsole(id: string): Console | undefined;
  listConsoles(): Console[];
  upsertConsole(c: Console): Promise<void>;

  // Schedules
  getSchedule(consoleId: string): Schedule | undefined;
  getDefaultSchedule(): Schedule;
  upsertSchedule(s: Schedule): Promise<void>;

  // Flags
  getFlags(consoleId: string): Flags | undefined;
  upsertFlags(f: Flags): Promise<void>;

  // Grants
  listGrants(consoleId: string, date: string): Grant[];
  addGrant(g: Grant): Promise<void>;

  // Quota
  getQuota(consoleId: string, date: string): QuotaState | undefined;
  listQuota(consoleId: string): QuotaState[];
  upsertQuota(q: QuotaState): Promise<void>;

  // Sessions
  getSession(id: string): Session | undefined;
  listOpenSessions(consoleId: string): Session[];
  addSession(s: Session): Promise<void>;
  updateSession(s: Session): Promise<void>;

  // Devices
  getDevice(id: string): Device | undefined;
  getDeviceByTokenHash(hash: string): Device | undefined;
  listDevices(): Device[];
  upsertDevice(d: Device): Promise<void>;
  deleteDevice(id: string): Promise<void>;

  // Commands
  listCommands(consoleId: string): Command[];
  addCommand(c: Command): Promise<void>;
  removeCommand(id: string): Promise<void>;

  // More-time requests
  listRequests(status?: RequestStatus): MoreTimeRequest[];
  getRequest(id: string): MoreTimeRequest | undefined;
  addRequest(r: MoreTimeRequest): Promise<void>;
  updateRequest(r: MoreTimeRequest): Promise<void>;
}
