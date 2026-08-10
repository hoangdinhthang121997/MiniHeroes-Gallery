
import crypto from 'node:crypto';
const AES_KEY = Buffer.from('2uWxvR7uEKhkGktH', 'utf8');
const AES_IV = Buffer.from('N8ul3EBGwz7Q1xYv', 'utf8');

export const SCHEMA_VERSION = 1;

export function decryptPayload(text) {
  const normalised = String(text).trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const cipher = Buffer.from(padded, 'base64');
  if (cipher.length === 0 || cipher.length % 16 !== 0) {
    throw new Error(`The response was not a whole number of cipher blocks (${cipher.length} bytes).`);
  }
  const decipher = crypto.createDecipheriv('aes-128-cbc', AES_KEY, AES_IV);
  const plain = Buffer.concat([decipher.update(cipher), decipher.final()]);
  return plain.toString('utf8');
}
function parsePossiblyDoubleEncoded(text) {
  let value = JSON.parse(text);
  for (let depth = 0; depth < 4 && typeof value === 'string'; depth += 1) {
    let next;
    try {
      next = JSON.parse(value);
    } catch {
      break;
    }
    value = next;
  }
  return value;
}
export function readLoginBody(body) {
  const text = body.toString('utf8').trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    let parsed;
    try {
      parsed = parsePossiblyDoubleEncoded(text);
    } catch {
      parsed = null;
    }
    if (parsed) {
      if (findAccount(parsed)) return parsed;
      const inner = Object.values(parsed).find(
        (value) => typeof value === 'string' && value.length > 100
      );
      if (inner) return parsePossiblyDoubleEncoded(decryptPayload(inner));
    }
  }
  return parsePossiblyDoubleEncoded(decryptPayload(text));
}
export function findAccount(root) {
  const seen = new Set();
  const queue = [{ node: root, depth: 0 }];
  while (queue.length > 0) {
    const { node, depth } = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node) || depth > 5) continue;
    seen.add(node);
    if (Array.isArray(node.heroInfo?.heroes)) return node;
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push({ node: value, depth: depth + 1 });
    }
  }
  return null;
}

function numericKeysAscending(record) {
  return Object.keys(record)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b));
}
function mapGear(entry, notes) {
  if (!entry || typeof entry !== 'object') return [];
  const slots = numericKeysAscending(entry);
  if (slots.length === 0) return [];
  return slots.map((slotKey) => {
    const slot = entry[slotKey] || {};
    return {
      slot: Number(slotKey),
      enhance: Number.isFinite(slot.l) ? slot.l : 0,
      locked: false,
      gems: mapGems(slot.gs),
    };
  });
}
function mapGems(sockets) {
  if (!sockets || typeof sockets !== 'object') return [];
  return numericKeysAscending(sockets).map((key) => {
    const value = sockets[key];
    if (value === -1) return -1;
    return value === 0 ? null : value;
  });
}
function mapArtifactDivinityLevels(levels) {
  if (!levels || typeof levels !== 'object') return null;
  const keys = numericKeysAscending(levels);
  if (keys.length === 0) return null;
  return keys.map((key) => levels[key]);
}

const round4 = (value) => Math.round(value * 10000) / 10000;
function mapAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return null;
  const pick = (name) => (Number.isFinite(attrs[name]) ? attrs[name] : null);
  const physical = pick('physicsDamage');
  const magical = pick('magicDamage');
  const atk = physical !== null && physical > 0 ? physical
    : magical !== null && magical > 0 ? magical
    : physical !== null ? physical
    : magical;
  const def = pick('defense');
  const hp = pick('life');
  const atkSpeed = pick('attackSpeed');
  const atkRange = pick('attackRange');
  const movSpeed = pick('movingSpeed');
  if ([atk, def, hp, atkSpeed, atkRange, movSpeed].every((value) => value === null)) return null;
  const out = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (Number.isFinite(value)) out[key] = value;
  }
  out.atk = atk === null ? null : Math.trunc(atk);
  out.def = def === null ? null : Math.trunc(def);
  out.hp = hp === null ? null : Math.trunc(hp);
  out.atkSpeed = atkSpeed === null ? null : round4(atkSpeed);
  out.atkRange = atkRange === null ? null : Math.trunc(atkRange);
  out.movSpeed = movSpeed === null ? null : Math.trunc(movSpeed);
  return out;
}

function mapPetRef(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value)) return null;
  const ref = Math.trunc(value);
  if (ref === 0) return false;
  return ref > 0 ? ref : null;
}

function mapArtifact(artifact, heroUuid) {
  if (!artifact || typeof artifact !== 'object') return null;
  if (!artifact.u) return null;
  const rawTier = Number.isFinite(artifact.q) ? Math.trunc(artifact.q) : null;
  const rarityTier = rawTier === null ? null : Math.max(1, Math.min(4, rawTier));
  const uuid = rarityTier !== null && rawTier !== rarityTier && Number.isFinite(heroUuid)
    ? Math.trunc(heroUuid) * 10 + rarityTier
    : artifact.u;
  return {
    uuid,
    stars: Number.isFinite(artifact.s) ? artifact.s : null,
    rarityTier,
  };
}

export function mapHero(hero, notes) {
  const heroNotes = [];
  const mapped = {
    uuid: hero.uuid,
    level: hero.l,
    starLevel: hero.s,
    maxStarLevel: Number.isFinite(hero.ms) ? hero.ms : null,
    rarityTier: hero.q,
    power: Number.isFinite(hero.power) ? hero.power : null,
    gear: mapGear(hero.e, heroNotes),
    runes: Array.isArray(hero.g) ? hero.g.slice() : null,
    artifactDivinityLevels: mapArtifactDivinityLevels(hero.ld),
    artifact: mapArtifact(hero.atf, hero.uuid),
    petRef: mapPetRef(hero.el),
    attrs: mapAttrs(hero.attrs),
    skin: hero.cs ? hero.cs : null,
  };
  if (notes) for (const note of heroNotes) notes.push(`hero ${hero.uuid}: ${note}`);
  return mapped;
}

function mapPetRegistry(account) {
  const raw = account && account.heroInfo && account.heroInfo.elf;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const resources = account && account.resource && typeof account.resource === 'object' ? account.resource : {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const petId = Number(key);
    if (!Number.isInteger(petId) || petId <= 0 || !value || typeof value !== 'object') continue;
    const level = Number(value.l);
    const bonded = Number(value.h);
    const skills = {};
    if (value.s && typeof value.s === 'object' && !Array.isArray(value.s)) {
      for (const [slot, rawLevel] of Object.entries(value.s)) {
        const n = Number(rawLevel);
        if (Number.isInteger(n) && n >= 0) skills[String(slot)] = n;
      }
    }
    const fragmentValue = Number(resources['elfP_' + petId]);
    out[String(petId)] = {
      petId,
      level: Number.isInteger(level) && level >= 1 ? level : null,
      bondedHeroUuid: Number.isInteger(bonded) && bonded >= 0 ? bonded : 0,
      skills,
      fragments: Number.isInteger(fragmentValue) && fragmentValue >= 0 ? fragmentValue : null,
    };
  }
  return out;
}

export function buildRoster(account, { catalogueVersion, capturedAt = new Date() }) {
  const heroes = account.heroInfo.heroes;
  const notes = [];
  const mapped = heroes.map((hero) => mapHero(hero, notes));
  const pets = mapPetRegistry(account);

  const missing = mapped.filter(
    (hero) =>
      !Number.isFinite(hero.uuid) ||
      !Number.isFinite(hero.level) ||
      !Number.isFinite(hero.starLevel) ||
      !Number.isFinite(hero.rarityTier)
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} of ${mapped.length} heroes were missing a required field ` +
        '(uuid, level, starLevel or rarityTier).'
    );
  }

  return {
    roster: {
      schemaVersion: SCHEMA_VERSION,
      catalogueVersion,
      capturedAt: capturedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      source: 'exporter',
      account: {
        teamLevel: Number.isFinite(account.roleLevel) ? account.roleLevel : null,
        heroCount: mapped.length,
      },
      pets,
      heroes: mapped,
    },
    notes,
  };
}
