
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { API_HOST } from './proxy.mjs';

function derLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let value = n;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const sequence = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const octetString = (buf) => tlv(0x04, buf);
const derNull = () => Buffer.from([0x05, 0x00]);
const utf8String = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));
const boolean = (value) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const explicit = (index, ...parts) => tlv(0xa0 | index, ...parts);

function objectIdentifier(dotted) {
  const parts = dotted.split('.').map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk = [];
    let value = part;
    do {
      chunk.unshift(value & 0x7f);
      value >>>= 7;
    } while (value > 0);
    for (let i = 0; i < chunk.length - 1; i += 1) chunk[i] |= 0x80;
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function integer(buf) {
  let body = Buffer.from(buf);
  let lead = 0;
  while (lead < body.length - 1 && body[lead] === 0) lead += 1;
  body = body.subarray(lead);
  if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return tlv(0x02, body);
}

function bitString(buf) {
  return tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
}

function utcTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const text =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return tlv(0x17, Buffer.from(text, 'ascii'));
}

function pem(label, der) {
  const body = der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

const OID_SHA256_WITH_RSA = '1.2.840.113549.1.1.11';
const OID_COMMON_NAME = '2.5.4.3';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

const VALID_DAYS = 3650;
function buildSelfSigned(hostname) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const signatureAlgorithm = sequence(objectIdentifier(OID_SHA256_WITH_RSA), derNull());
  const name = sequence(set(sequence(objectIdentifier(OID_COMMON_NAME), utf8String(hostname))));

  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(now.getTime() + VALID_DAYS * 24 * 60 * 60 * 1000);

  const extensions = sequence(
    sequence(
      objectIdentifier(OID_BASIC_CONSTRAINTS),
      boolean(true),
      octetString(sequence())
    ),
    sequence(
      objectIdentifier(OID_SUBJECT_ALT_NAME),
      octetString(sequence(tlv(0x82, Buffer.from(hostname, 'ascii'))))
    ),
    sequence(
      objectIdentifier(OID_EXT_KEY_USAGE),
      octetString(sequence(objectIdentifier(OID_SERVER_AUTH)))
    )
  );

  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))), // v3
    integer(crypto.randomBytes(16)),
    signatureAlgorithm,
    name,
    sequence(utcTime(notBefore), utcTime(notAfter)),
    name,
    Buffer.from(publicKey),
    explicit(3, extensions)
  );

  const signature = crypto.sign('sha256', tbs, privateKey);
  const certificate = sequence(tbs, signatureAlgorithm, bitString(signature));

  return { key: privateKey, cert: pem('CERTIFICATE', certificate) };
}
export function createRunCertificate() {
  return buildSelfSigned(API_HOST);
}
export function removeLegacyCertificateStore(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return null;
  }
  const removed = [];
  const left = [];
  for (const name of entries) {
    try {
      fs.rmSync(path.join(directory, name), { recursive: true, force: true });
      removed.push(name);
    } catch {
      left.push(name);
    }
  }
  try {
    fs.rmdirSync(directory);
  } catch {
    left.push(path.basename(directory));
  }
  return { directory, removed, left };
}
