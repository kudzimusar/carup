import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const EFFECT_CLASS = Object.freeze({
  IN_APP_ONLY: 'IN_APP_ONLY',
  EXTERNAL_CHANNEL_POSSIBLE: 'EXTERNAL_CHANNEL_POSSIBLE',
  NON_COMMUNICATION_SIDE_EFFECT: 'NON_COMMUNICATION_SIDE_EFFECT',
  AUDIT_ONLY: 'AUDIT_ONLY',
  NO_CURRENT_SUBSCRIBER: 'NO_CURRENT_SUBSCRIBER',
  UNKNOWN_REQUIRES_REVIEW: 'UNKNOWN_REQUIRES_REVIEW',
});

const INTERNAL_CHANNELS = new Set(['in_app', 'web_chat', 'mobile_chat']);

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function stringsIn(source) {
  return [...source.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function communicationEventTypes(root) {
  const source = read(root, 'backend/services/communication/communicationEventListeners.js');
  const marker = 'export const COMMUNICATION_EVENT_TYPES = [';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('COMMUNICATION_EVENT_TYPES registry not found');
  const end = source.indexOf('];', start);
  if (end < 0) throw new Error('COMMUNICATION_EVENT_TYPES registry is unterminated');
  // Registry entries are one quoted literal per line. An unanchored quote scan
  // also treats apostrophes in comments (for example "authority's") as string
  // delimiters and silently drops real event names that follow. Parse only the
  // array's literal entry lines so comments cannot hide current subscribers.
  const body = source.slice(start + marker.length, end);
  const entries = [...body.matchAll(/^\s*['"]([^'"]+)['"]\s*,?/gm)].map((match) => match[1]);
  return new Set(entries
    .filter((value) => value.includes('.') || /^[A-Z][A-Z0-9_]+$/.test(value)));
}

function balancedObjectAfter(source, key) {
  const quoted = [`'${key}': {`, `"${key}": {`];
  let at = -1;
  let open = -1;
  for (const marker of quoted) {
    at = source.indexOf(marker);
    if (at >= 0) {
      open = source.indexOf('{', at + marker.length - 1);
      break;
    }
  }
  if (open < 0) return null;

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

function communicationPolicy(root, eventType) {
  const rel = 'backend/services/communication/communicationNotificationService.js';
  const source = read(root, rel);
  const block = balancedObjectAfter(source, eventType);
  if (!block) return null;
  const channelsBody = /channels:\s*\[([^\]]*)\]/.exec(block)?.[1] || '';
  const channels = stringsIn(channelsBody);
  const notificationType = /notificationType:\s*['"]([^'"]+)['"]/.exec(block)?.[1] || null;
  const templateKey = /templateKey:\s*['"]([^'"]+)['"]/.exec(block)?.[1] || null;
  return { channels, notificationType, templateKey, source: rel };
}

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (/\.[cm]?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

function literalSubscribers(root) {
  const map = new Map();
  const services = path.join(root, 'backend', 'services');
  for (const file of walkJs(services)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\.subscribe\(\s*['"]([^'"]+)['"]/g)) {
      const eventType = match[1];
      const rel = path.relative(root, file);
      map.set(eventType, [...(map.get(eventType) || []), rel]);
    }
  }
  return map;
}

export function classifyEventType(eventType, options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const type = String(eventType || '').trim();
  if (!type) {
    return {
      event_type: type,
      known_subscriber: null,
      communications_subscriber: null,
      communications_policy: null,
      in_app_notification_potential: null,
      external_channel_potential: null,
      effect_class: EFFECT_CLASS.UNKNOWN_REQUIRES_REVIEW,
      confidence: 'unknown',
      source_files: [],
    };
  }

  const commTypes = options.communicationTypes || communicationEventTypes(root);
  const direct = options.literalSubscribers || literalSubscribers(root);

  if (commTypes.has(type)) {
    const policy = communicationPolicy(root, type);
    if (!policy || !policy.channels.length) {
      return {
        event_type: type,
        known_subscriber: true,
        communications_subscriber: true,
        communications_policy: policy,
        in_app_notification_potential: null,
        external_channel_potential: null,
        effect_class: EFFECT_CLASS.UNKNOWN_REQUIRES_REVIEW,
        confidence: 'requires_review',
        source_files: ['backend/services/communication/communicationEventListeners.js', policy?.source].filter(Boolean),
      };
    }
    const inApp = policy.channels.some((channel) => INTERNAL_CHANNELS.has(channel));
    const external = policy.channels.some((channel) => !INTERNAL_CHANNELS.has(channel));
    return {
      event_type: type,
      known_subscriber: true,
      communications_subscriber: true,
      communications_policy: {
        notification_type: policy.notificationType,
        template_key: policy.templateKey,
        channels: policy.channels,
      },
      in_app_notification_potential: inApp,
      external_channel_potential: external,
      effect_class: external ? EFFECT_CLASS.EXTERNAL_CHANNEL_POSSIBLE : EFFECT_CLASS.IN_APP_ONLY,
      confidence: 'source_exact',
      source_files: [
        'backend/services/communication/communicationEventListeners.js',
        policy.source,
      ],
    };
  }

  const subscribers = direct.get(type) || [];
  if (subscribers.length) {
    return {
      event_type: type,
      known_subscriber: true,
      communications_subscriber: false,
      communications_policy: null,
      in_app_notification_potential: false,
      external_channel_potential: false,
      effect_class: EFFECT_CLASS.NON_COMMUNICATION_SIDE_EFFECT,
      confidence: 'source_exact_literal_subscriber',
      source_files: subscribers,
    };
  }

  return {
    event_type: type,
    known_subscriber: false,
    communications_subscriber: false,
    communications_policy: null,
    in_app_notification_potential: false,
    external_channel_potential: false,
    effect_class: EFFECT_CLASS.NO_CURRENT_SUBSCRIBER,
    confidence: 'source_scan_no_exact_subscriber',
    source_files: [],
  };
}

export function classifyEventTypes(eventTypes, options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const shared = {
    root,
    communicationTypes: communicationEventTypes(root),
    literalSubscribers: literalSubscribers(root),
  };
  return [...new Set((eventTypes || []).map((value) => String(value || '').trim()).filter(Boolean))]
    .sort()
    .map((eventType) => classifyEventType(eventType, shared));
}
