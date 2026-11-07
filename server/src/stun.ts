/** Minimal STUN binding responder (RFC 5389) for LAN peers. It only tells a browser which address it was seen from,
 * giving WebRTC a usable LAN candidate when mDNS host candidates do not resolve. It never relays traffic. */
import { createSocket, type Socket } from 'node:dgram';

const MAGIC = 0x2112a442;

/** Build a Binding Success Response carrying XOR-MAPPED-ADDRESS for an IPv4 sender, or null for anything else. */
export function bindingResponse(request: Buffer, address: string, port: number): Buffer | null {
  if (request.length < 20 || request.readUInt16BE(0) !== 0x0001 || request.readUInt32BE(4) !== MAGIC) return null;
  const octets = address.replace(/^::ffff:/, '').split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  const response = Buffer.alloc(32);
  response.writeUInt16BE(0x0101, 0); response.writeUInt16BE(12, 2); response.writeUInt32BE(MAGIC, 4);
  request.copy(response, 8, 8, 20);
  response.writeUInt16BE(0x0020, 20); response.writeUInt16BE(8, 22); response.writeUInt8(0, 24); response.writeUInt8(0x01, 25);
  response.writeUInt16BE(port ^ (MAGIC >>> 16), 26);
  response.writeUInt32BE((((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) ^ MAGIC) >>> 0, 28);
  return response;
}

export function startStun(port: number, host = '0.0.0.0'): Promise<Socket> {
  const socket = createSocket('udp4');
  socket.on('message', (message, remote) => {
    const response = bindingResponse(message, remote.address, remote.port);
    if (response) socket.send(response, remote.port, remote.address);
  });
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, host, () => { socket.off('error', reject); socket.on('error', () => {}); resolve(socket); });
  });
}
