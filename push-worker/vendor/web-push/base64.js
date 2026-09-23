import { stringToUint8Array, toUint8Array, uint8ArrayToBase64, } from '../uint8array-extras/index.js';
export function encodeBase64Url(value) {
    return uint8ArrayToBase64(toUint8Array(value), { urlSafe: true });
}
export function objectToBase64Url(obj) {
    return encodeBase64Url(stringToUint8Array(JSON.stringify(obj)));
}
