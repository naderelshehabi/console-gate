import { createHash } from 'node:crypto';
import type { Store } from '../store/store';
import type { Console, ConsoleKind, Device, DeviceKind } from '../types';
import { hashPin, verifyPin } from './pin';
import { uuid, randomToken, numericCode } from '../util/ids';

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface PairingEntry {
  code: string;
  expires: number;
}

interface PinSession {
  token: string;
  expires: number;
}

export interface ClaimOptions {
  deviceKind: DeviceKind;
  deviceName: string;
  pushToken?: string | null;
  consoleKind?: ConsoleKind; // required when deviceKind === 'agent'
  consoleName?: string;
}

export interface ClaimResult {
  device: Device;
  token: string; // plaintext, returned once
  console?: Console;
}

/**
 * Authentication & pairing. Holds the parent PIN verifier, issues device
 * tokens, manages short-lived pairing codes + PIN sessions, and enforces
 * rate-limiting/lockout on PIN attempts.
 */
export class AuthService {
  private pairings = new Map<string, PairingEntry>();
  private pinSessions = new Map<string, PinSession>();
  private failedAttempts: number[] = []; // timestamps of recent failures

  constructor(
    private readonly store: Store,
    private readonly now: () => number,
    private readonly opts: {
      pairTtlMs?: number;
      pinSessionTtlMs?: number;
      lockoutThreshold?: number;
      lockoutWindowMs?: number;
    } = {},
  ) {}

  private get pairTtlMs() {
    return this.opts.pairTtlMs ?? 5 * 60 * 1000;
  }
  private get pinSessionTtlMs() {
    return this.opts.pinSessionTtlMs ?? 10 * 60 * 1000;
  }
  private get lockoutThreshold() {
    return this.opts.lockoutThreshold ?? 5;
  }
  private get lockoutWindowMs() {
    return this.opts.lockoutWindowMs ?? 5 * 60 * 1000;
  }

  // PIN --------------------------------------------------------------------
  isPinSet(): boolean {
    return this.store.getPinRecord() !== null;
  }

  /** Set or change the PIN. If a PIN already exists, `oldPin` must verify. */
  async setPin(newPin: string, oldPin?: string): Promise<void> {
    if (!/^\d{4,12}$/.test(newPin)) throw new ValidationError('PIN must be 4–12 digits');
    if (this.isPinSet()) {
      if (!oldPin || !this.verifyPinRaw(oldPin)) throw new AuthError('current PIN required');
    }
    await this.store.setPinRecord(hashPin(newPin));
  }

  isLockedOut(): boolean {
    this.pruneFailures();
    return this.failedAttempts.length >= this.lockoutThreshold;
  }

  private pruneFailures(): void {
    const cutoff = this.now() - this.lockoutWindowMs;
    this.failedAttempts = this.failedAttempts.filter((t) => t >= cutoff);
  }

  private verifyPinRaw(pin: string): boolean {
    const rec = this.store.getPinRecord();
    if (!rec) return false;
    return verifyPin(pin, rec);
  }

  /** Verify a PIN with lockout enforcement. Returns true on success. */
  verifyPin(pin: string): boolean {
    if (this.isLockedOut()) throw new LockedOutError('too many attempts; try again later');
    const ok = this.verifyPinRaw(pin);
    if (!ok) {
      this.failedAttempts.push(this.now());
    } else {
      this.failedAttempts = [];
    }
    return ok;
  }

  /** Verify a PIN and, on success, create a short-lived PIN session token. */
  createPinSession(pin: string): { token: string; expires: number } {
    if (!this.verifyPin(pin)) throw new AuthError('invalid PIN');
    const token = randomToken(24);
    const expires = this.now() + this.pinSessionTtlMs;
    this.pinSessions.set(token, { token, expires });
    return { token, expires };
  }

  verifyPinSession(token: string | undefined): boolean {
    if (!token) return false;
    const s = this.pinSessions.get(token);
    if (!s) return false;
    if (s.expires < this.now()) {
      this.pinSessions.delete(token);
      return false;
    }
    return true;
  }

  // Pairing ----------------------------------------------------------------
  startPairing(): { code: string; expires: number } {
    const code = numericCode(6);
    const expires = this.now() + this.pairTtlMs;
    this.pairings.set(code, { code, expires });
    return { code, expires };
  }

  async claimPairing(code: string, options: ClaimOptions): Promise<ClaimResult> {
    const entry = this.pairings.get(code);
    if (!entry || entry.expires < this.now()) {
      this.pairings.delete(code);
      throw new AuthError('invalid or expired pairing code');
    }
    this.pairings.delete(code);

    const token = randomToken(32);
    const tokenHash = sha256(token);
    const deviceId = uuid();
    let consoleObj: Console | undefined;

    if (options.deviceKind === 'agent') {
      if (!options.consoleKind || !options.consoleName) {
        throw new ValidationError('agent pairing requires consoleKind and consoleName');
      }
      consoleObj = {
        id: uuid(),
        kind: options.consoleKind,
        name: options.consoleName,
        pairedAt: this.now(),
        lastSeen: null,
        agentVersion: null,
        fwNotes: null,
      };
      await this.store.upsertConsole(consoleObj);
    }

    const device: Device = {
      id: deviceId,
      kind: options.deviceKind,
      name: options.deviceName,
      consoleId: consoleObj?.id ?? null,
      tokenHash,
      pushToken: options.pushToken ?? null,
      pairedAt: this.now(),
      lastSeen: null,
    };
    await this.store.upsertDevice(device);
    return { device, token, console: consoleObj };
  }

  /**
   * Ensure a singleton web-UI device exists and issue it a fresh token. Browsers
   * authenticate with the parent PIN (web/login) rather than the agent pairing
   * flow; this gives them a bearer device token for read endpoints.
   */
  async ensureWebDevice(name: string): Promise<{ device: Device; token: string }> {
    const token = randomToken(32);
    const tokenHash = sha256(token);
    const existing = this.store.listDevices().find((d) => d.kind === 'web' && d.name === name);
    if (existing) {
      const updated: Device = { ...existing, tokenHash, lastSeen: this.now() };
      await this.store.upsertDevice(updated);
      return { device: updated, token };
    }
    const device: Device = {
      id: uuid(),
      kind: 'web',
      name,
      consoleId: null,
      tokenHash,
      pushToken: null,
      pairedAt: this.now(),
      lastSeen: null,
    };
    await this.store.upsertDevice(device);
    return { device, token };
  }

  // Token auth -------------------------------------------------------------
  authenticate(token: string | undefined): Device | undefined {
    if (!token) return undefined;
    return this.store.getDeviceByTokenHash(sha256(token));
  }

  async revoke(deviceId: string): Promise<void> {
    await this.store.deleteDevice(deviceId);
  }
}

export class AuthError extends Error {}
export class ValidationError extends Error {}
export class LockedOutError extends Error {}
