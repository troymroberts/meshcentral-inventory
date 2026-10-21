'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const network = require('../lib/network');

const SWITCH_MAC = 'aa:bb:cc:00:00:01';

function netport(overrides) {
    return Object.assign({
        _id: 'inventorynetport//port-1', type: 'inventorynetport', domain: '', scope: { kind: 'domain' },
        site: 'Office/Default', jack: '2-14', room: 'Reception', patchPanel: 'A', patchPanelPort: '14',
        switchName: 'BSL-SW1', switchMac: SWITCH_MAC, switchPort: 14, status: 'active', notes: ''
    }, overrides || {});
}

test('normalizes MAC addresses and rejects placeholders or free text', () => {
    assert.equal(network.normalizeMac('AA-BB-CC-DD-EE-FF'), 'aa:bb:cc:dd:ee:ff');
    assert.equal(network.normalizeMac('aabb.ccdd.eeff'), 'aa:bb:cc:dd:ee:ff');
    assert.equal(network.normalizeMac('AABBCCDDEEFF'), 'aa:bb:cc:dd:ee:ff');
    assert.equal(network.normalizeMac('00:00:00:00:00:00'), '');
    assert.equal(network.normalizeMac('ff:ff:ff:ff:ff:ff'), '');
    assert.equal(network.normalizeMac('port aabbccddeeff'), '');
    assert.equal(network.normalizeMac('aa:bb:cc'), '');
});

test('switch ports are whole numbers from 1 to 512 or empty', () => {
    assert.deepEqual(network.parsePort(''), { port: null, error: '' });
    assert.deepEqual(network.parsePort(null), { port: null, error: '' });
    assert.deepEqual(network.parsePort(' 14 '), { port: 14, error: '' });
    assert.deepEqual(network.parsePort(512), { port: 512, error: '' });
    for (const invalid of ['0', '513', '1.5', 'x', '-3']) assert.ok(network.parsePort(invalid).error, invalid);
});

test('network port input normalizes fields and reports validation errors', () => {
    const parsed = network.netportInput({ site: ' Office ', jack: '2-14', location: 'Room 2', patch_panel: 'A', switch_mac: 'AA-BB-CC-00-00-01', switch_port: '14', status: 'ACTIVE' });
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.value.site, 'Office');
    assert.equal(parsed.value.room, 'Room 2');
    assert.equal(parsed.value.patchPanel, 'A');
    assert.equal(parsed.value.switchMac, SWITCH_MAC);
    assert.equal(parsed.value.switchPort, 14);
    assert.equal(parsed.value.status, 'active');
    assert.equal(network.netportInput({ jack: '1' }).value.status, 'active');
    const invalid = network.netportInput({ switchMac: 'nope', switchPort: '900', status: 'broken' });
    assert.equal(invalid.errors.length, 4);
});

test('network port rows enforce unique site/jack and unique active switch ports', () => {
    const existing = [netport(), netport({ _id: 'inventorynetport//port-2', jack: '2-15', switchPort: 15, status: 'inactive' })];
    const rows = network.prepareNetportRows([
        { site: 'office/default', jack: '2-14' },
        { site: 'Office/Default', jack: '3-1', switchMac: SWITCH_MAC, switchPort: 14 },
        { site: 'Office/Default', jack: '3-2', switchMac: SWITCH_MAC, switchPort: 15 },
        { site: 'Office/Default', jack: '3-3', switchMac: SWITCH_MAC, switchPort: 15 },
        { site: 'Office/Default', jack: '3-4', switchMac: SWITCH_MAC, switchPort: 16, status: 'inactive' },
        { site: 'Office/Default', jack: '3-5', switchMac: SWITCH_MAC, switchPort: 16, status: 'inactive' },
        { site: 'Other', jack: '2-14' }
    ], existing, null);
    assert.ok(rows[0].errors.some((error) => error.includes('already exists')));
    assert.ok(rows[1].errors.some((error) => error.includes('already documented as jack 2-14')));
    assert.deepEqual(rows[2].errors, [], 'an inactive port does not reserve its switch port');
    assert.ok(rows[3].errors.some((error) => error.includes('CSV row 4')));
    assert.deepEqual(rows[4].errors, []);
    assert.deepEqual(rows[5].errors, [], 'inactive ports may share a switch port');
    assert.deepEqual(rows[6].errors, [], 'the same jack label may exist at another site');
    assert.deepEqual(network.prepareNetportRows([{ site: 'Office/Default', jack: '2-14', switchMac: SWITCH_MAC, switchPort: 14 }], existing, 'inventorynetport//port-1')[0].errors, []);
    assert.throws(() => network.prepareNetportRows([], existing), /No network port rows/);
    assert.throws(() => network.prepareNetportRows(new Array(501).fill({ jack: 'x' }), []), /maximum of 500/);
});

test('network port CSV parses flexible headers and round-trips through export', () => {
    const rows = network.parseNetportCsv('﻿Site,Jack,Room,Patch Panel,patch_panel_port,switch-name,SwitchMac,switchPort,status,notes\r\n"Office/Default",2-14,"Room, 2",A,14,BSL-SW1,AA:BB:CC:00:00:01,14,active,"said ""hi"""\r\n\r\n');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rowNumber, 2);
    assert.equal(rows[0].room, 'Room, 2');
    assert.equal(rows[0].patchPanel, 'A');
    assert.equal(rows[0].notes, 'said "hi"');
    const prepared = network.prepareNetportRows(rows, [], null);
    assert.deepEqual(prepared[0].errors, []);
    const csv = network.netportsToCsv([Object.assign({}, prepared[0].value)]);
    assert.equal(csv.split('\r\n')[0], network.NETPORT_CSV_FIELDS.join(','));
    const reparsed = network.parseNetportCsv(csv);
    assert.equal(reparsed[0].room, 'Room, 2');
    assert.equal(reparsed[0].switchPort, '14');
    assert.match(network.netportsToCsv([{ jack: '=cmd()' }]), /"'=cmd\(\)"/);
    assert.throws(() => network.parseNetportCsv('jack,colour\r\n1,red'), /Unsupported CSV column: colour/);
    assert.throws(() => network.parseNetportCsv('site,room\r\nA,B'), /requires a "jack" column/);
    assert.throws(() => network.parseNetportCsv('jack,jack\r\n1,2'), /Duplicate CSV column/);
    assert.throws(() => network.parseNetportCsv('jack\r\n"1'), /unclosed quoted field/);
    assert.throws(() => network.parseNetportCsv('jack'), /header and at least one/);
});

test('observations are normalized and the connection type is inferred', () => {
    const wired = network.observationInput({ mac: 'AA-BB-CC-DD-EE-01', ip: '10.0.0.5', site: 'Office/Default', switchName: 'BSL-SW1', switchMac: 'AABBCC000001', switchPort: '3', ssid: 'ignored', source: 'unifi-mcp', seenAt: '2026-10-21T10:00:00Z' }, 0);
    assert.deepEqual(wired.errors, []);
    assert.equal(wired.value.connection, 'wired');
    assert.equal(wired.value.mac, 'aa:bb:cc:dd:ee:01');
    assert.equal(wired.value.switchMac, SWITCH_MAC);
    assert.equal(wired.value.switchPort, 3);
    assert.equal(wired.value.ssid, '');
    assert.equal(wired.value.seenAt, '2026-10-21T10:00:00.000Z');
    const wireless = network.observationInput({ apName: 'Lobby-AP', ssid: 'Staff' }, Date.parse('2026-10-21T11:00:00Z'));
    assert.equal(wireless.value.connection, 'wireless');
    assert.equal(wireless.value.source, 'external');
    assert.equal(wireless.value.seenAt, '2026-10-21T11:00:00.000Z');
    const invalid = network.observationInput({ mac: 'x', ip: '999.1.1.1', switchMac: 'y', apMac: 'z', switchPort: 0, connection: 'fibre', seenAt: 'soon' });
    assert.equal(invalid.errors.length, 7);
});

test('observations write history only when the connection point changes', () => {
    const asset = { name: 'HazelPC', history: [] };
    const first = network.observationInput({ mac: 'aa:bb:cc:dd:ee:01', site: 'Office', switchName: 'BSL-SW1', switchMac: SWITCH_MAC, switchPort: 12, seenAt: '2026-10-21T10:00:00Z' }).value;
    assert.deepEqual(network.applyObservation(asset, first, 'tester', 1), { changed: true, moved: true, stale: false });
    assert.match(asset.history[0].details, /^First seen on BSL-SW1 port 12/);
    assert.deepEqual(asset.network.knownMacs, ['aa:bb:cc:dd:ee:01']);

    const sameSpot = Object.assign({}, first, { seenAt: '2026-10-21T10:05:00.000Z' });
    assert.deepEqual(network.applyObservation(asset, sameSpot, 'tester', 2), { changed: false, moved: false, stale: false });
    assert.equal(asset.history.length, 1);
    assert.equal(asset.network.observed.seenAt, '2026-10-21T10:05:00.000Z');

    const moved = Object.assign({}, first, { switchPort: 3, seenAt: '2026-10-21T10:10:00.000Z' });
    assert.equal(network.applyObservation(asset, moved, 'tester', 3).moved, true);
    assert.equal(asset.history[1].action, 'network.moved');
    assert.equal(asset.history[1].details, 'Moved from BSL-SW1 port 12 to BSL-SW1 port 3 (Office)');

    const older = Object.assign({}, first, { switchPort: 9, seenAt: '2026-10-21T09:00:00.000Z' });
    assert.deepEqual(network.applyObservation(asset, older, 'tester', 4), { changed: false, moved: false, stale: true });
    assert.equal(asset.network.observed.switchPort, 3);
});

test('jack resolution and network issue detection', () => {
    const ports = [netport(), netport({ _id: 'inventorynetport//port-2', jack: '2-3', switchPort: 3 })];
    const observed = network.observationInput({ site: 'Office/Default', switchName: 'BSL-SW1', switchMac: SWITCH_MAC, switchPort: 14 }).value;
    const asset = { network: { observed } };
    const resolved = network.resolveJack(observed, ports);
    assert.equal(resolved.jack, '2-14');
    assert.equal(resolved.patchPanel, 'A');
    assert.equal(resolved.ambiguous, false);
    assert.deepEqual(network.assetNetworkIssues(asset, ports), []);

    asset.network.documentedJack = 'inventorynetport//port-2';
    assert.deepEqual(network.assetNetworkIssues(asset, ports).map((issue) => issue.kind), ['network-mismatch']);
    asset.network.documentedJack = 'inventorynetport//deleted';
    assert.match(network.assetNetworkIssues(asset, ports)[0].message, /no longer exists/);

    const undocumented = { network: { observed: Object.assign({}, observed, { switchPort: 40 }), documentedJack: 'inventorynetport//port-1' } };
    assert.deepEqual(network.assetNetworkIssues(undocumented, ports).map((issue) => issue.kind), ['network-undocumented', 'network-mismatch']);
    const inactive = [netport({ status: 'inactive' })];
    assert.deepEqual(network.assetNetworkIssues({ network: { observed } }, inactive).map((issue) => issue.kind), ['network-undocumented']);
    const wireless = { network: { observed: network.observationInput({ apName: 'Lobby' }).value, documentedJack: 'inventorynetport//port-1' } };
    assert.deepEqual(network.assetNetworkIssues(wireless, ports), [], 'wireless sightings are not compared with wall jacks');

    // Without a switch MAC, the observation falls back to the switch name.
    const byName = network.observationInput({ site: 'office/default', switchName: 'bsl-sw1', switchPort: 14 }).value;
    assert.equal(network.resolveJack(byName, ports).jack, '2-14');
    assert.equal(network.resolveJack(Object.assign({}, byName, { site: 'Elsewhere' }), ports), null);

    const duplicates = ports.concat([netport({ _id: 'inventorynetport//port-3', jack: '9-9' })]);
    const issues = network.netportIssues(duplicates);
    assert.equal(issues.get('inventorynetport//port-1')[0].kind, 'netport-duplicate-switch-port');
    assert.equal(issues.get('inventorynetport//port-3')[0].kind, 'netport-duplicate-switch-port');
    assert.deepEqual(issues.get('inventorynetport//port-2'), []);
    assert.equal(network.resolveJack(observed, duplicates).ambiguous, true);

    const output = network.publicNetwork({ network: { observed, documentedJack: 'inventorynetport//port-1' } }, ports);
    assert.equal(output.resolvedJack.id, 'inventorynetport//port-1');
    assert.equal(output.documentedJackInfo.jack, '2-14');
    assert.deepEqual(output.issues, []);
    assert.deepEqual(network.publicNetwork({}, undefined), { observed: null, knownMacs: [], documentedJack: '', documentedJackInfo: null, resolvedJack: null, issues: [] });
});

test('reads MAC addresses from MeshCentral interface records', () => {
    assert.deepEqual(network.interfaceMacs({
        netif2: { Ethernet: [{ mac: 'AA:BB:CC:DD:EE:01', family: 'IPv4' }, { mac: 'aa:bb:cc:dd:ee:01', family: 'IPv6' }], Loopback: [{ mac: '00:00:00:00:00:00' }] },
        netif: [{ mac: 'aa-bb-cc-dd-ee-02' }]
    }), ['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02']);
    assert.deepEqual(network.interfaceMacs(null), []);
});

function harness(initialRecords, options) {
    options = options || {};
    const records = new Map((initialRecords || []).map((record) => [record._id, JSON.parse(JSON.stringify(record))]));
    const database = {
        Get(id, callback) { callback(null, records.has(id) ? [JSON.parse(JSON.stringify(records.get(id)))] : []); },
        GetAll(callback) { callback(null, Array.from(records.values()).map((record) => JSON.parse(JSON.stringify(record)))); },
        GetAllTypeNoTypeField(type, domain, callback) {
            callback(null, Array.from(records.values()).filter((record) => record.type === type && record.domain === domain).map((record) => {
                const copy = JSON.parse(JSON.stringify(record));
                delete copy.type;
                return copy;
            }));
        },
        Set(document, callback) { records.set(document._id, JSON.parse(JSON.stringify(document))); callback(null); },
        Remove(id, callback) { records.delete(id); callback(null); }
    };
    const pluginHandler = {
        parent: {
            db: database,
            webserver: {
                meshes: { 'mesh//group-1': { name: 'Group 1' }, 'mesh//group-2': { name: 'Group 2' } },
                GetAllMeshIdWithRights(user) { return user.meshes || []; }
            },
            config: { domains: { '': {} } }
        },
        registerPermissions() {},
        getAccessPermissions(name, user) { return Promise.resolve((permission) => !(options.denied || []).includes(permission) && !(user.denied || []).includes(permission)); }
    };
    const plugin = require('../inventory').inventory(pluginHandler);
    let counter = 0;
    function invoke(user, command) {
        return new Promise((resolve) => {
            const session = { domain: { id: '' }, user, ws: { send(message) { resolve(JSON.parse(message)); } } };
            plugin.serveraction(Object.assign({ requestId: `network-${++counter}` }, command), session);
        });
    }
    return { records, invoke };
}

const admin = { _id: 'user//admin', domain: '', siteadmin: 0xFFFFFFFF };
const scoped = { _id: 'user//tech', domain: '', siteadmin: 0, meshes: ['mesh//group-1'] };
const workstation = {
    _id: 'inventoryasset//hazel', type: 'inventoryasset', domain: '', assetKind: 'workstation', source: 'automatic',
    nodeid: 'node//hazel', nodeids: ['node//hazel'], meshid: 'mesh//group-1', meshName: 'Group 1', name: 'HazelPC', status: 'Available',
    identity: { serial: 'HAZEL-1', uuid: '' }, automatic: { nodeExists: true }, manual: {},
    assignment: { mode: 'unassigned', assignees: [], pending: [] }, history: []
};
const hiddenWorkstation = Object.assign({}, workstation, {
    _id: 'inventoryasset//hidden', nodeid: 'node//hidden', nodeids: ['node//hidden'], meshid: 'mesh//group-2', name: 'HiddenPC', identity: { serial: 'HIDDEN-1', uuid: '' }
});

test('network ports can be created, listed, updated, exported, and deleted through plugin actions', async () => {
    const { records, invoke } = harness([workstation]);
    let response = await invoke(admin, { pluginaction: 'netport-create', netport: { site: 'Office/Default', jack: '2-14', room: 'Reception', patchPanel: 'A', patchPanelPort: '14', switchName: 'BSL-SW1', switchMac: 'AA-BB-CC-00-00-01', switchPort: '14' } });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.kind, 'netport-created');
    const created = response.result.netports[0];
    assert.match(created.id, /^inventorynetport\/\/[0-9a-f]{32}$/);
    assert.equal(created.switchMac, SWITCH_MAC);
    assert.equal(created.switchPort, 14);
    assert.deepEqual(created.scope, { kind: 'domain' });
    assert.equal(records.get(created.id).type, 'inventorynetport');

    response = await invoke(admin, { pluginaction: 'netport-create', netport: { site: 'office/default', jack: '2-14' } });
    assert.equal(response.ok, false);
    assert.match(response.error, /already exists/);

    response = await invoke(admin, { pluginaction: 'netport-preview', csv: 'site,jack,switchMac,switchPort\nOffice/Default,2-15,aa:bb:cc:00:00:01,14\nOffice/Default,2-16,aa:bb:cc:00:00:01,16\n' });
    assert.equal(response.ok, true, response.error);
    assert.ok(response.result.rows[0].errors.some((error) => error.includes('already documented')));
    assert.deepEqual(response.result.rows[1].errors, []);
    response = await invoke(admin, { pluginaction: 'netport-import', csv: 'site,jack,switchMac,switchPort\nOffice/Default,2-15,aa:bb:cc:00:00:01,14\n' });
    assert.equal(response.ok, false);
    assert.match(response.error, /1 invalid row/);
    response = await invoke(admin, { pluginaction: 'netport-import', rows: [{ site: 'Office/Default', jack: '2-16', switchMac: 'aa:bb:cc:00:00:01', switchPort: 16 }] });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.count, 1);

    response = await invoke(admin, { pluginaction: 'netport-update', netportId: created.id, changes: { room: 'Front desk', status: 'faulty' } });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.kind, 'netport');
    assert.equal(response.result.netport.room, 'Front desk');
    assert.equal(response.result.unchanged, false);
    assert.equal(records.get(created.id).history.at(-1).action, 'netport.updated');
    response = await invoke(admin, { pluginaction: 'netport-update', netportId: created.id, changes: { room: 'Front desk' } });
    assert.equal(response.result.unchanged, true);

    response = await invoke(admin, { pluginaction: 'netport-list', site: 'OFFICE/DEFAULT' });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.kind, 'netport-list');
    assert.deepEqual(response.result.netports.map((item) => item.jack), ['2-14', '2-16']);
    assert.deepEqual(response.result.sites, ['Office/Default']);
    assert.deepEqual(response.result.statuses, network.NETPORT_STATUSES);
    assert.equal(response.result.capabilities.canUseDomainScope, true);

    response = await invoke(admin, { pluginaction: 'netport-export' });
    assert.equal(response.result.kind, 'netport-export');
    assert.equal(response.result.count, 2);
    assert.match(response.result.csv, /^site,jack,room,patchPanel,patchPanelPort,switchName,switchMac,switchPort,status,notes\r\nOffice\/Default,2-14,Front desk,A,14,BSL-SW1,aa:bb:cc:00:00:01,14,faulty,\r\n/);

    response = await invoke(admin, { pluginaction: 'netport-delete', netportId: created.id });
    assert.equal(response.ok, false);
    response = await invoke(admin, { pluginaction: 'netport-delete', netportId: created.id, confirm: true });
    assert.equal(response.ok, true);
    assert.equal(response.result.kind, 'netport-deleted');
    assert.equal(records.has(created.id), false);
});

test('network port scope and permissions follow device-group visibility', async () => {
    const { invoke } = harness([
        workstation,
        Object.assign(netport({ _id: 'inventorynetport//group-2', jack: 'G2' }), { scope: { kind: 'mesh', meshid: 'mesh//group-2' } }),
        Object.assign(netport({ _id: 'inventorynetport//group-1', jack: 'G1', switchPort: 1 }), { scope: { kind: 'mesh', meshid: 'mesh//group-1' } }),
        netport({ _id: 'inventorynetport//domain', jack: 'D1', switchPort: 2 })
    ]);
    let response = await invoke(scoped, { pluginaction: 'netport-list' });
    assert.deepEqual(response.result.netports.map((item) => item.jack), ['D1', 'G1']);
    assert.equal(response.result.capabilities.canUseDomainScope, false);
    response = await invoke(scoped, { pluginaction: 'netport-create', netport: { jack: 'X1' } });
    assert.match(response.error, /device group you can access is required/);
    response = await invoke(scoped, { pluginaction: 'netport-create', netport: { jack: 'X1', meshid: 'mesh//group-2' } });
    assert.match(response.error, /not found or not accessible/);
    response = await invoke(scoped, { pluginaction: 'netport-create', netport: { jack: 'X1', meshid: 'mesh//group-1' } });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.netports[0].scope.meshName, 'Group 1');
    response = await invoke(scoped, { pluginaction: 'netport-update', netportId: 'inventorynetport//group-2', changes: { room: 'x' } });
    assert.match(response.error, /not found or not accessible/);
    response = await invoke(scoped, { pluginaction: 'netport-delete', netportId: 'inventorynetport//group-2', confirm: true });
    assert.match(response.error, /not found or not accessible/);
    const viewer = Object.assign({}, scoped, { denied: ['can_manage'] });
    response = await invoke(viewer, { pluginaction: 'netport-list' });
    assert.equal(response.ok, true);
    assert.equal(response.result.capabilities.canManage, false);
    response = await invoke(viewer, { pluginaction: 'netport-create', netport: { jack: 'X2', meshid: 'mesh//group-1' } });
    assert.match(response.error, /Permission denied/);
    response = await invoke(viewer, { pluginaction: 'network-observe', nodeid: 'node//hazel', observation: { switchMac: SWITCH_MAC, switchPort: 2 } });
    assert.match(response.error, /Permission denied/);
});

test('network observations locate assets by node, MAC, or asset id and resolve documented jacks', async () => {
    const ifinfo = { _id: 'ifnode//hazel', type: 'ifinfo', domain: '', netif2: { Ethernet: [{ mac: 'AA:BB:CC:DD:EE:01', address: '10.0.0.5' }] } };
    const { records, invoke } = harness([workstation, hiddenWorkstation, ifinfo, netport(), netport({ _id: 'inventorynetport//port-3', jack: '2-3', switchPort: 3 })]);
    const observation = { ip: '10.0.0.5', site: 'Office/Default', connection: 'wired', switchName: 'BSL-SW1', switchMac: SWITCH_MAC, switchPort: 14, source: 'unifi-mcp', seenAt: '2026-10-21T10:00:00Z' };

    let response = await invoke(scoped, { pluginaction: 'network-observe', mac: 'aa-bb-cc-dd-ee-01', observation });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.kind, 'network-observed');
    assert.equal(response.result.moved, true);
    assert.equal(response.result.asset.id, workstation._id);
    assert.equal(response.result.asset.network.observed.mac, 'aa:bb:cc:dd:ee:01');
    assert.equal(response.result.asset.network.resolvedJack.jack, '2-14');
    assert.deepEqual(response.result.asset.network.issues, []);
    assert.equal(response.result.asset.history, undefined);
    assert.match(records.get(workstation._id).history.at(-1).details, /^First seen on BSL-SW1 port 14/);
    assert.deepEqual(records.get(workstation._id).network.knownMacs, ['aa:bb:cc:dd:ee:01']);

    // A MAC that the agent no longer reports is still found from earlier sightings.
    records.delete(ifinfo._id);
    response = await invoke(scoped, { pluginaction: 'network-observe', mac: 'aa:bb:cc:dd:ee:01', observation: Object.assign({}, observation, { seenAt: '2026-10-21T10:05:00Z' }) });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.moved, false);
    assert.equal(records.get(workstation._id).history.length, 1);

    response = await invoke(scoped, { pluginaction: 'network-observe', nodeid: 'node//hidden', observation });
    assert.match(response.error, /not found or not accessible/);
    response = await invoke(scoped, { pluginaction: 'network-observe', assetId: hiddenWorkstation._id, observation });
    assert.match(response.error, /not found or not accessible/);
    response = await invoke(scoped, { pluginaction: 'network-observe', observation: { switchPort: 3 } });
    assert.match(response.error, /assetId, nodeid, or mac is required/);
    response = await invoke(scoped, { pluginaction: 'network-observe', nodeid: 'node//hazel', observation: { switchPort: 999 } });
    assert.match(response.error, /Switch port must be/);

    response = await invoke(scoped, { pluginaction: 'update', assetId: workstation._id, changes: { documentedJack: 'inventorynetport//port-1' } });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.unchanged, false);
    assert.equal(response.result.asset.network.documentedJack, 'inventorynetport//port-1');
    assert.equal(records.get(workstation._id).history.at(-1).action, 'network.documented-jack');
    response = await invoke(scoped, { pluginaction: 'update', assetId: workstation._id, changes: { documentedJack: 'inventorynetport//missing' } });
    assert.match(response.error, /Network port not found/);

    response = await invoke(scoped, { pluginaction: 'network-observe', nodeid: 'node//hazel', observation: Object.assign({}, observation, { switchPort: 3, seenAt: '2026-10-21T11:00:00Z' }) });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.moved, true);
    assert.equal(response.result.asset.network.resolvedJack.jack, '2-3');
    assert.deepEqual(response.result.asset.network.issues.map((issue) => issue.kind), ['network-mismatch']);
    assert.equal(records.get(workstation._id).history.at(-1).details, 'Moved from BSL-SW1 port 14 to BSL-SW1 port 3 (Office/Default)');

    response = await invoke(scoped, { pluginaction: 'network-observe', assetId: workstation._id, observation: Object.assign({}, observation, { switchPort: 40, seenAt: '2026-10-21T12:00:00Z' }) });
    assert.equal(response.ok, true, response.error);
    assert.deepEqual(response.result.asset.network.issues.map((issue) => issue.kind), ['network-undocumented', 'network-mismatch']);

    response = await invoke(scoped, { pluginaction: 'get', assetId: workstation._id });
    assert.equal(response.result.asset.network.documentedJackInfo.jack, '2-14');
    assert.equal(response.result.asset.network.observed.switchPort, 40);
    response = await invoke(scoped, { pluginaction: 'list' });
    const listed = response.result.assets.find((asset) => asset.id === workstation._id);
    assert.equal(listed.network.issues.length, 2);
    assert.equal(response.result.summary.review, 1);

    response = await invoke(scoped, { pluginaction: 'network-observe', nodeid: 'node//hazel', observation: Object.assign({}, observation, { switchPort: 14, seenAt: '2026-10-21T13:00:00Z' }) });
    assert.equal(response.result.moved, true);
    response = await invoke(scoped, { pluginaction: 'netport-list' });
    const jack = response.result.netports.find((item) => item.jack === '2-14');
    assert.deepEqual(jack.observedAssets, [{ id: workstation._id, name: 'HazelPC' }]);
});

test('full Inventory backup includes network port records', async () => {
    const { invoke } = harness([workstation, netport()]);
    const response = await invoke(admin, { pluginaction: 'backup-export' });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.result.backup.counts.inventorynetport, 1);
    assert.ok(response.result.backup.records.some((record) => record._id === 'inventorynetport//port-1'));
    const restored = await invoke(admin, { pluginaction: 'backup-restore', backup: response.result.backup, confirm: 'RESTORE INVENTORY' });
    assert.equal(restored.ok, true, restored.error);
    assert.equal(restored.result.restored, 2);
});

test('browser view exposes the network ports tab, asset network panel, and network actions without HTML injection', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'inventory.handlebars'), 'utf8');
    for (const id of ['networkTab', 'netportSection', 'netportModal', 'netportImportModal', 'networkSection', 'documentedJackInput', 'netportExportButton']) {
        assert.match(view, new RegExp(`id="${id}"`), id);
    }
    for (const action of ['netport-list', 'netport-create', 'netport-update', 'netport-delete', 'netport-preview', 'netport-import', 'netport-export']) {
        assert.ok(view.includes(`'${action}'`), action);
    }
    assert.match(view, /changes\.documentedJack = byId\('documentedJackInput'\)\.value/);
    assert.equal(/innerHTML/.test(view), false);
});

test('release packaging scripts include the network module', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..');
    assert.match(fs.readFileSync(path.join(root, 'scripts', 'package.sh'), 'utf8'), /lib\/network\.js/);
    assert.match(fs.readFileSync(path.join(root, 'scripts', 'package.ps1'), 'utf8'), /lib\\network\.js/);
});
