'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('manifest has the fields required by the MeshCentral 1.2.5 and 1.2.6 plugin loader', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json'), 'utf8'));
    for (const field of ['name', 'shortName', 'version', 'description', 'homepage', 'changelogUrl', 'configUrl', 'meshCentralCompat']) {
        assert.equal(typeof config[field], 'string', field);
        assert.ok(config[field].length > 0, field);
    }
    assert.equal(config.shortName, 'inventory');
    assert.equal(config.name, 'Inventory');
    assert.equal(config.version, '1.4.2.2');
    assert.equal(config.hasAdminPanel, true);
    assert.equal(config.repository.type, 'git');
    assert.equal(typeof config.repository.url, 'string');
    assert.equal(typeof config.downloadUrl, 'string');
    assert.equal(config.configUrl, 'https://raw.githubusercontent.com/troymroberts/meshcentral-inventory/main/config.json');
    // MeshCentral drops the query string when following redirects, so GitHub release assets
    // (302 to a signed URL) cannot be downloaded; serve the tag's committed zip directly.
    assert.equal(config.downloadUrl, 'https://raw.githubusercontent.com/troymroberts/meshcentral-inventory/v1.4.2.2/release-assets/MeshCentral-Inventory.zip');
    // MeshCentral 1.3.0's plugin loader (isValidConfig) rejects a config without changelogUrl.
    assert.equal(config.changelogUrl, 'https://github.com/troymroberts/meshcentral-inventory/releases');
    assert.equal(config.versionHistoryUrl, undefined);
    assert.equal(config.meshCentralCompat, '>=1.2.5');
});
