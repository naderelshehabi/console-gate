import dgram from 'node:dgram';

/**
 * Minimal SNTP (RFC 4330) client over UDP. Best-effort: callers must handle
 * failure and fall back to the host clock. No external dependencies.
 */

const NTP_EPOCH_OFFSET = 2_208_988_800; // seconds between 1900-01-01 and 1970-01-01

export interface SntpResult {
  /** Server's view of current UTC at the moment of response, epoch ms. */
  serverTimeMs: number;
  /** Estimated offset to apply to the host clock: serverTime - hostTime, ms. */
  offsetMs: number;
  /** Round-trip delay in ms. */
  roundTripMs: number;
  server: string;
}

/** Encode a client request packet (mode 3, version 4). */
function buildRequest(): Buffer {
  const buf = Buffer.alloc(48);
  // LI = 0, VN = 4, Mode = 3  => 0b00_100_011 = 0x23
  buf[0] = 0x23;
  return buf;
}

/** Read a 64-bit NTP timestamp (seconds.fraction) at offset, return epoch ms. */
function readNtpTimestamp(buf: Buffer, offset: number): number {
  const seconds = buf.readUInt32BE(offset);
  const fraction = buf.readUInt32BE(offset + 4);
  const ms = (seconds - NTP_EPOCH_OFFSET) * 1000 + (fraction / 0x1_0000_0000) * 1000;
  return ms;
}

/**
 * Parse a server reply given the client send/receive host times (ms).
 * Exposed for unit testing the offset/delay math without a network.
 */
export function parseReply(
  reply: Buffer,
  clientSendMs: number,
  clientRecvMs: number,
  server = 'test',
): SntpResult {
  if (reply.length < 48) throw new Error('SNTP reply too short');
  const receiveTs = readNtpTimestamp(reply, 32); // T2: server receive
  const transmitTs = readNtpTimestamp(reply, 40); // T3: server transmit
  const t1 = clientSendMs;
  const t4 = clientRecvMs;
  const offsetMs = (receiveTs - t1 + (transmitTs - t4)) / 2;
  const roundTripMs = t4 - t1 - (transmitTs - receiveTs);
  return {
    serverTimeMs: t4 + offsetMs,
    offsetMs,
    roundTripMs: Math.max(0, roundTripMs),
    server,
  };
}

/** Build a synthetic server reply for tests (T2/T3 set to `serverNowMs`). */
export function buildReply(serverNowMs: number): Buffer {
  const buf = Buffer.alloc(48);
  buf[0] = 0x24; // LI=0 VN=4 Mode=4 (server)
  const write = (offset: number, ms: number) => {
    const ntp = ms / 1000 + NTP_EPOCH_OFFSET;
    const seconds = Math.floor(ntp);
    const fraction = Math.floor((ntp - seconds) * 0x1_0000_0000);
    buf.writeUInt32BE(seconds >>> 0, offset);
    buf.writeUInt32BE(fraction >>> 0, offset + 4);
  };
  write(32, serverNowMs);
  write(40, serverNowMs);
  return buf;
}

/** Query a single NTP server. Resolves with the result or rejects on timeout/error. */
export function querySntp(server: string, opts?: { port?: number; timeoutMs?: number }): Promise<SntpResult> {
  const port = opts?.port ?? 123;
  const timeoutMs = opts?.timeoutMs ?? 3000;
  return new Promise<SntpResult>((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`SNTP timeout: ${server}`))), timeoutMs);
    socket.on('error', (err) => finish(() => reject(err)));
    socket.on('message', (msg) => {
      const recv = Date.now();
      try {
        const result = parseReply(msg, sendMs, recv, server);
        finish(() => resolve(result));
      } catch (err) {
        finish(() => reject(err as Error));
      }
    });
    const sendMs = Date.now();
    socket.send(buildRequest(), port, server, (err) => {
      if (err) finish(() => reject(err));
    });
  });
}
