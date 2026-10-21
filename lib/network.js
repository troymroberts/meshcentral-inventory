'use strict';

// Physical network documentation (wall jacks, patch panels and switch ports)
// and the latest observed connection of each inventory asset. Everything in
// this module is pure: inventory.js owns database access, permissions and
// device-group scoping.

const model = require('./model');

const NETPORT_STATUSES = Object.freeze(['active', 'inactive', 'unpatched', 'faulty']);
const NETPORT_CSV_FIELDS = Object.freeze(['site', 'jack', 'room', 'patchPanel', 'patchPanelPort', 'switchName', 'switchMac', 'switchPort', 'status', 'notes']);
const CONNECTION_TYPES = Object.freeze(['wired', 'wireless']);
const MAX_NETPORT_ROWS = 500;
const MAX_CSV_BYTES = 1024 * 1024;
const MAX_KNOWN_MACS = 32;
const MAX_PORT = 512;

const text = model.text;

function normalizeMac(value) {
    const hex = text(value, 64).toLowerCase().replace(/[^0-9a-f]/g, '');
    if (hex.length !== 12 || /^0+$/.test(hex) || /^f+$/.test(hex)) return '';
    // Only accept the usual separator styles so that free text containing
    // twelve hex digits is not silently accepted as a MAC address.
    if (!/^([0-9a-f]{2}([:-]?)){5}[0-9a-f]{2}$/i.test(text(value, 64)) && !/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(text(value, 64))) return '';
    return hex.match(/.{2}/g).join(':');
}

// Returns { port, error } where port is an integer 1-512 or null when empty.
function parsePort(value) {
    if (value === null || value === undefined || text(value, 16) === '') return { port: null, error: '' };
    const raw = text(value, 16);
    if (!/^\d{1,3}$/.test(raw)) return { port: null, error: `Switch port must be a whole number from 1 to ${MAX_PORT}.` };
    const port = Number(raw);
    if (port < 1 || port > MAX_PORT) return { port: null, error: `Switch port must be a whole number from 1 to ${MAX_PORT}.` };
    return { port, error: '' };
}

function normalizeStatus(value) {
    const input = text(value, 32).toLowerCase();
    return NETPORT_STATUSES.includes(input) ? input : '';
}

function pick(input, names) {
    for (const name of names) {
        if (input[name] !== undefined && input[name] !== null) return input[name];
    }
    return undefined;
}

function netportInput(input) {
    input = input && typeof input === 'object' ? input : {};
    const rawMac = text(pick(input, ['switchMac', 'switch_mac', 'switchmac']), 64);
    const rawStatus = text(pick(input, ['status']), 32);
    const portResult = parsePort(pick(input, ['switchPort', 'switch_port', 'switchport']));
    const result = {
        site: text(pick(input, ['site']), 256),
        jack: text(pick(input, ['jack']), 64),
        room: text(pick(input, ['room', 'location']), 256),
        patchPanel: text(pick(input, ['patchPanel', 'patch_panel', 'patchpanel']), 128),
        patchPanelPort: text(pick(input, ['patchPanelPort', 'patch_panel_port', 'patchpanelport']), 32),
        switchName: text(pick(input, ['switchName', 'switch_name', 'switchname']), 256),
        switchMac: normalizeMac(rawMac),
        switchPort: portResult.port,
        status: rawStatus ? normalizeStatus(rawStatus) : 'active',
        notes: text(pick(input, ['notes']), 4000)
    };
    const errors = [];
    if (!result.jack) errors.push('Jack is required.');
    if (rawMac && !result.switchMac) errors.push('Switch MAC must be a MAC address such as aa:bb:cc:dd:ee:ff.');
    if (portResult.error) errors.push(portResult.error);
    if (!result.status) errors.push(`Status must be one of: ${NETPORT_STATUSES.join(', ')}.`);
    return { value: result, errors };
}

function siteJackKey(site, jack) {
    return `${text(site, 256).toLowerCase()}\n${text(jack, 64).toLowerCase()}`;
}

function switchPortKey(switchMac, switchPort) {
    const mac = normalizeMac(switchMac);
    const port = Number(switchPort);
    return mac && Number.isInteger(port) && port > 0 ? `${mac}#${port}` : '';
}

function isActive(netport) {
    return Boolean(netport) && (netport.status || 'active') === 'active';
}

function portLabel(netport) {
    const site = text(netport && netport.site, 256);
    return `jack ${text(netport && netport.jack, 64)}${site ? ` at ${site}` : ''}`;
}

// Validates rows against existing records and against each other. A row with
// an id (an update) is excluded from the existing-record checks for itself.
function prepareNetportRows(rows, existing, excludedId) {
    if (!Array.isArray(rows)) throw new Error('Network port rows are required.');
    if (rows.length === 0) throw new Error('No network port rows were provided.');
    if (rows.length > MAX_NETPORT_ROWS) throw new Error(`A maximum of ${MAX_NETPORT_ROWS} network ports can be imported at once.`);
    const jackOwners = new Map();
    const switchOwners = new Map();
    for (const netport of existing || []) {
        if (!netport || netport._id === excludedId) continue;
        jackOwners.set(siteJackKey(netport.site, netport.jack), portLabel(netport));
        const key = switchPortKey(netport.switchMac, netport.switchPort);
        if (key && isActive(netport)) switchOwners.set(key, portLabel(netport));
    }
    return rows.map((row, index) => {
        const rowNumber = Number(row && row.rowNumber) || index + 2;
        const parsed = netportInput(row);
        const errors = parsed.errors.slice();
        const value = parsed.value;
        if (value.jack) {
            const key = siteJackKey(value.site, value.jack);
            if (jackOwners.has(key)) errors.push(`Jack ${value.jack}${value.site ? ` at ${value.site}` : ''} already exists.`);
            else jackOwners.set(key, `CSV row ${rowNumber}`);
        }
        const switchKey = switchPortKey(value.switchMac, value.switchPort);
        if (switchKey && value.status === 'active') {
            if (switchOwners.has(switchKey)) errors.push(`Switch ${value.switchMac} port ${value.switchPort} is already documented as ${switchOwners.get(switchKey)}.`);
            else switchOwners.set(switchKey, `CSV row ${rowNumber}`);
        }
        return { rowNumber, value, errors };
    });
}

function addNetportHistory(netport, action, actor, details, now) {
    model.addHistory(netport, action, actor, details, now);
}

function createNetport(id, domain, value, scope, actor, now) {
    const netport = Object.assign({
        _id: id,
        type: 'inventorynetport',
        domain,
        schemaVersion: 1,
        scope: scope || { kind: 'domain' }
    }, value, {
        createdAt: now,
        updatedAt: now,
        createdBy: text(actor, 256),
        history: []
    });
    addNetportHistory(netport, 'netport.created', actor, `Created network port ${portLabel(netport)}`, now);
    return netport;
}

function applyNetport(netport, value, actor, now) {
    const changed = NETPORT_CSV_FIELDS.filter((field) => {
        if (field === 'switchPort') return (netport.switchPort === undefined ? null : netport.switchPort) !== value.switchPort;
        return text(netport[field], 4000) !== text(value[field], 4000);
    });
    if (changed.length === 0) return false;
    for (const field of NETPORT_CSV_FIELDS) netport[field] = value[field];
    netport.updatedAt = now;
    addNetportHistory(netport, 'netport.updated', actor, `Updated ${changed.join(', ')}`, now);
    return true;
}

function csvCell(cell) {
    const content = cell === null || cell === undefined ? '' : String(cell);
    // Prefix spreadsheet formula triggers so exported data cannot execute.
    const safe = /^[=+\-@\t\r]/.test(content) ? `'${content}` : content;
    return /[",\r\n]/.test(safe) || safe !== content ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function netportsToCsv(netports) {
    const lines = [NETPORT_CSV_FIELDS.join(',')];
    for (const netport of netports || []) {
        lines.push(NETPORT_CSV_FIELDS.map((field) => csvCell(field === 'switchPort' ? (netport.switchPort || '') : netport[field])).join(','));
    }
    return lines.join('\r\n') + '\r\n';
}

function csvHeaderKey(header) {
    return text(header, 64).toLowerCase().replace(/[\s_-]+/g, '');
}

// Parses CSV text into row objects keyed by the canonical camelCase column
// names. Headers are matched case-insensitively and ignore spaces, hyphens
// and underscores, so "Patch Panel Port" and patch_panel_port both work.
function parseNetportCsv(input) {
    const source = String(input === null || input === undefined ? '' : input);
    if (Buffer.byteLength(source, 'utf8') > MAX_CSV_BYTES) throw new Error('CSV files are limited to 1 MB.');
    const csv = source.replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let index = 0; index < csv.length; index++) {
        const character = csv[index];
        if (quoted) {
            if (character === '"' && csv[index + 1] === '"') { field += '"'; index++; }
            else if (character === '"') quoted = false;
            else field += character;
        } else if (character === '"') quoted = true;
        else if (character === ',') { row.push(field); field = ''; }
        else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
        else field += character;
    }
    if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
    if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
    const nonEmpty = rows.filter((cells) => cells.some((cell) => text(cell, 4096) !== ''));
    if (nonEmpty.length < 2) throw new Error('The CSV must contain a header and at least one network port row.');
    const known = new Map(NETPORT_CSV_FIELDS.map((name) => [csvHeaderKey(name), name]));
    known.set('location', 'room');
    const headers = nonEmpty[0].map((header) => known.get(csvHeaderKey(header)) || '');
    const unknown = nonEmpty[0].filter((header, index) => !headers[index]);
    if (unknown.length) throw new Error(`Unsupported CSV column${unknown.length === 1 ? '' : 's'}: ${unknown.map((item) => text(item, 64)).join(', ')}.`);
    const duplicate = headers.find((header, index) => headers.indexOf(header) !== index);
    if (duplicate) throw new Error(`Duplicate CSV column: ${duplicate}.`);
    if (!headers.includes('jack')) throw new Error('The CSV requires a "jack" column.');
    if (nonEmpty.length - 1 > MAX_NETPORT_ROWS) throw new Error(`A maximum of ${MAX_NETPORT_ROWS} network ports can be imported at once.`);
    return nonEmpty.slice(1).map((cells, index) => {
        if (cells.length > headers.length) throw new Error(`CSV row ${index + 2} has more columns than the header.`);
        const record = { rowNumber: index + 2 };
        headers.forEach((header, column) => { record[header] = text(cells[column], 4096); });
        return record;
    });
}

function normalizeIp(value) {
    const ip = text(value, 64);
    if (!ip) return '';
    if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((part) => Number(part) <= 255)) return ip;
    if (/^[0-9a-f:.]+$/i.test(ip) && ip.includes(':')) return ip.toLowerCase();
    return '';
}

// Validates an observation reported by an external collector (for example a
// UniFi MCP client). Returns { value, errors }.
function observationInput(input, now) {
    input = input && typeof input === 'object' ? input : {};
    const errors = [];
    const rawMac = text(input.mac, 64);
    const rawSwitchMac = text(input.switchMac, 64);
    const rawApMac = text(input.apMac, 64);
    const rawIp = text(input.ip, 64);
    const rawConnection = text(input.connection, 16).toLowerCase();
    const portResult = parsePort(input.switchPort);
    let seenAt = new Date(Number(now) || Date.now()).toISOString();
    if (input.seenAt !== undefined && input.seenAt !== null && input.seenAt !== '') {
        const parsed = typeof input.seenAt === 'number' ? input.seenAt : Date.parse(text(input.seenAt, 64));
        if (!Number.isFinite(parsed)) errors.push('seenAt must be an ISO date and time.');
        else seenAt = new Date(parsed).toISOString();
    }
    const value = {
        mac: normalizeMac(rawMac),
        ip: normalizeIp(rawIp),
        site: text(input.site, 256),
        connection: CONNECTION_TYPES.includes(rawConnection) ? rawConnection : '',
        switchName: text(input.switchName, 256),
        switchMac: normalizeMac(rawSwitchMac),
        switchPort: portResult.port,
        apName: text(input.apName, 256),
        apMac: normalizeMac(rawApMac),
        ssid: text(input.ssid, 64),
        source: text(input.source, 64) || 'external',
        seenAt
    };
    if (rawMac && !value.mac) errors.push('mac must be a MAC address.');
    if (rawSwitchMac && !value.switchMac) errors.push('switchMac must be a MAC address.');
    if (rawApMac && !value.apMac) errors.push('apMac must be a MAC address.');
    if (rawIp && !value.ip) errors.push('ip must be an IPv4 or IPv6 address.');
    if (portResult.error) errors.push(portResult.error);
    if (rawConnection && !value.connection) errors.push(`connection must be one of: ${CONNECTION_TYPES.join(', ')}.`);
    if (!value.connection) {
        if (value.switchMac || value.switchName || value.switchPort) value.connection = 'wired';
        else if (value.apMac || value.apName || value.ssid) value.connection = 'wireless';
    }
    if (value.connection === 'wired') { value.apName = ''; value.apMac = ''; value.ssid = ''; }
    if (value.connection === 'wireless') { value.switchName = ''; value.switchMac = ''; value.switchPort = null; }
    return { value, errors };
}

function connectionLabel(observed) {
    if (!observed) return '';
    if (observed.connection === 'wireless') {
        const ap = observed.apName || observed.apMac || 'unknown access point';
        return `AP ${ap}${observed.ssid ? ` (SSID ${observed.ssid})` : ''}`;
    }
    const name = observed.switchName || observed.switchMac || 'unknown switch';
    return `${name}${observed.switchPort ? ` port ${observed.switchPort}` : ''}`;
}

// The parts of an observation that describe where the asset is connected.
// IP address and timestamps are deliberately excluded.
function connectionKey(observed) {
    if (!observed) return '';
    return JSON.stringify([
        text(observed.site, 256).toLowerCase(),
        observed.connection || '',
        observed.switchMac || text(observed.switchName, 256).toLowerCase(),
        observed.switchPort || null,
        observed.apMac || text(observed.apName, 256).toLowerCase()
    ]);
}

function knownMacs(asset) {
    const network = asset && asset.network || {};
    const macs = (Array.isArray(network.knownMacs) ? network.knownMacs : []).map(normalizeMac).filter(Boolean);
    const observedMac = network.observed && normalizeMac(network.observed.mac);
    if (observedMac) macs.push(observedMac);
    return Array.from(new Set(macs));
}

function rememberMac(asset, mac) {
    const normalized = normalizeMac(mac);
    if (!normalized) return false;
    asset.network = asset.network || {};
    const current = Array.isArray(asset.network.knownMacs) ? asset.network.knownMacs : [];
    if (current.includes(normalized)) return false;
    asset.network.knownMacs = current.concat([normalized]).slice(-MAX_KNOWN_MACS);
    return true;
}

// Stores the latest sighting. History is written only when the connection
// point changes. Returns { changed, moved, stale }.
function applyObservation(asset, observation, actor, now) {
    asset.network = asset.network || {};
    const previous = asset.network.observed || null;
    const previousSeen = previous ? Date.parse(previous.seenAt) : NaN;
    if (Number.isFinite(previousSeen) && Date.parse(observation.seenAt) < previousSeen) {
        return { changed: false, moved: false, stale: true };
    }
    const macAdded = rememberMac(asset, observation.mac);
    const moved = !previous || connectionKey(previous) !== connectionKey(observation);
    const changed = moved || macAdded || !previous || previous.ip !== observation.ip || previous.mac !== observation.mac || previous.source !== observation.source;
    asset.network.observed = Object.assign({}, observation);
    if (moved) {
        const site = observation.site ? ` (${observation.site})` : '';
        const details = previous
            ? `Moved from ${connectionLabel(previous)}${previous.site && previous.site !== observation.site ? ` (${previous.site})` : ''} to ${connectionLabel(observation)}${site}`
            : `First seen on ${connectionLabel(observation)}${site}`;
        model.addHistory(asset, previous ? 'network.moved' : 'network.first-seen', actor, details, now);
    }
    if (changed) asset.updatedAt = now;
    return { changed, moved, stale: false };
}

function sameSwitch(netport, observed) {
    if (observed.switchMac && netport.switchMac) return observed.switchMac === netport.switchMac;
    // Fall back to the switch name only when the observation has no MAC.
    if (!observed.switchMac && observed.switchName && netport.switchName) {
        return observed.switchName.toLowerCase() === text(netport.switchName, 256).toLowerCase();
    }
    return false;
}

// Active netports whose switch/port matches the observed wired connection,
// sorted by site and jack so the result is deterministic.
function matchingNetports(observed, netports) {
    if (!observed || observed.connection !== 'wired' || !observed.switchPort) return [];
    return (netports || []).filter((netport) => isActive(netport)
        && Number(netport.switchPort) === Number(observed.switchPort)
        && sameSwitch(netport, observed)
        && (!observed.site || !netport.site || observed.site.toLowerCase() === text(netport.site, 256).toLowerCase() || Boolean(observed.switchMac && netport.switchMac)))
        .sort((left, right) => siteJackKey(left.site, left.jack).localeCompare(siteJackKey(right.site, right.jack)));
}

function jackSummary(netport) {
    if (!netport) return null;
    return {
        id: netport._id,
        site: netport.site || '',
        jack: netport.jack || '',
        room: netport.room || '',
        patchPanel: netport.patchPanel || '',
        patchPanelPort: netport.patchPanelPort || '',
        switchName: netport.switchName || '',
        switchMac: netport.switchMac || '',
        switchPort: netport.switchPort || null,
        status: netport.status || 'active'
    };
}

function resolveJack(observed, netports) {
    const matches = matchingNetports(observed, netports);
    if (matches.length === 0) return null;
    return Object.assign(jackSummary(matches[0]), { ambiguous: matches.length > 1 });
}

function assetNetworkIssues(asset, netports) {
    const network = asset && asset.network || {};
    const observed = network.observed;
    const issues = [];
    const wiredPort = Boolean(observed && observed.connection === 'wired' && observed.switchPort && (observed.switchMac || observed.switchName));
    const resolved = wiredPort ? resolveJack(observed, netports) : null;
    if (wiredPort && !resolved) {
        issues.push({ kind: 'network-undocumented', message: `Observed on ${connectionLabel(observed)}, but no active network port documents that switch port.` });
    }
    if (network.documentedJack && wiredPort) {
        const documented = (netports || []).find((netport) => netport._id === network.documentedJack);
        if (!documented) {
            issues.push({ kind: 'network-mismatch', message: 'The documented jack no longer exists.' });
        } else if (!resolved || resolved.id !== documented._id) {
            issues.push({
                kind: 'network-mismatch',
                message: `Documented at ${portLabel(documented)}, but observed on ${connectionLabel(observed)}${resolved ? ` (${portLabel(resolved)})` : ''}.`
            });
        }
    }
    return issues;
}

// Returns Map<netportId, issues[]> for every netport in the supplied list.
function netportIssues(netports) {
    const bySwitchPort = new Map();
    for (const netport of netports || []) {
        const key = switchPortKey(netport.switchMac, netport.switchPort);
        if (!key || !isActive(netport)) continue;
        bySwitchPort.set(key, (bySwitchPort.get(key) || []).concat([netport]));
    }
    const result = new Map((netports || []).map((netport) => [netport._id, []]));
    for (const group of bySwitchPort.values()) {
        if (group.length < 2) continue;
        for (const netport of group) {
            const others = group.filter((item) => item._id !== netport._id).map(portLabel);
            result.get(netport._id).push({
                kind: 'netport-duplicate-switch-port',
                message: `Switch ${netport.switchMac} port ${netport.switchPort} is also documented as ${others.join(', ')}.`
            });
        }
    }
    return result;
}

function publicNetwork(asset, netports) {
    const network = asset && asset.network || {};
    const observed = network.observed ? Object.assign({}, network.observed) : null;
    const documented = network.documentedJack
        ? (netports || []).find((netport) => netport._id === network.documentedJack) || null
        : null;
    return {
        observed,
        knownMacs: knownMacs(asset),
        documentedJack: network.documentedJack || '',
        documentedJackInfo: jackSummary(documented),
        resolvedJack: observed ? resolveJack(observed, netports) : null,
        issues: Array.isArray(netports) ? assetNetworkIssues(asset, netports) : []
    };
}

function publicNetport(netport, issues, observedAssets) {
    return Object.assign(jackSummary(netport), {
        notes: netport.notes || '',
        scope: netport.scope || { kind: 'domain' },
        issues: issues || [],
        observedAssets: observedAssets || [],
        createdAt: netport.createdAt || null,
        updatedAt: netport.updatedAt || null,
        history: netport.history || []
    });
}

// Collects MAC addresses from a MeshCentral "ifinfo" record (netif2 is an
// object of interface arrays; older agents report a netif array).
function interfaceMacs(ifinfo) {
    const macs = [];
    if (!ifinfo || typeof ifinfo !== 'object') return macs;
    const groups = [];
    if (ifinfo.netif2 && typeof ifinfo.netif2 === 'object') groups.push(...Object.values(ifinfo.netif2));
    if (Array.isArray(ifinfo.netif)) groups.push(ifinfo.netif);
    for (const group of groups) {
        for (const entry of Array.isArray(group) ? group : [group]) {
            const mac = entry && normalizeMac(entry.mac);
            if (mac && !macs.includes(mac)) macs.push(mac);
        }
    }
    return macs;
}

module.exports = {
    NETPORT_STATUSES,
    NETPORT_CSV_FIELDS,
    CONNECTION_TYPES,
    normalizeMac,
    parsePort,
    netportInput,
    prepareNetportRows,
    createNetport,
    applyNetport,
    netportsToCsv,
    parseNetportCsv,
    observationInput,
    applyObservation,
    connectionLabel,
    connectionKey,
    knownMacs,
    rememberMac,
    resolveJack,
    matchingNetports,
    jackSummary,
    portLabel,
    assetNetworkIssues,
    netportIssues,
    publicNetwork,
    publicNetport,
    interfaceMacs
};
