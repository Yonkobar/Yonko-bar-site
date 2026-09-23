import { stringToUint8Array } from '../uint8array-extras/index.js';
// RFC 8291 §3.4
export function createKeyInfo(clientPublic, serverPublic) {
    return new Uint8Array([
        ...stringToUint8Array('WebPush: info\0'),
        ...clientPublic,
        ...serverPublic,
    ]);
}
export function createInfo(type) {
    return stringToUint8Array(`Content-Encoding: ${type}\0`);
}
