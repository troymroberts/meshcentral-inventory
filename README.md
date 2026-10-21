# MeshCentral Inventory

> **Fork notice.** This is a reviewed fork of [maxdorx/meshcentral-inventory](https://github.com/maxdorx/meshcentral-inventory)
> maintained by troymroberts. The plugin's update channel (`config.json` → `configUrl`/`downloadUrl`) points at this
> fork's **tagged releases**, so MeshCentral's *Upgrade* button only offers versions published here after review.
> Upstream changes are merged deliberately (`git fetch upstream && git diff main upstream/main`), then released as
> `<upstream version>.<fork revision>` (e.g. `1.4.2.1`). See `NOTICE` for attribution.

Inventory and lifecycle management for MeshCentral workstations and peripherals.

## Features

- Automatically discovers agent-backed workstations.
- Tracks hardware identity by serial number and UUID.
- Shows live agent connectivity and linked MeshCentral records.
- Assigns the first reported user and sends later changes for review.
- Supports manual workstations and peripherals.
- Provides lifecycle states, notes, locations, purchase dates, and warranties.
- Detects missing, stale, duplicate, and conflicting records.
- Includes CSV peripheral import/export, permissions, and audit history.
- Downloads and restores a full, validated Inventory backup.
- Documents wall jacks, patch panels, and switch ports, and records where each asset was last seen on the network.

## Network

The **Network ports** tab documents each cable run: site, jack, room, patch panel and port, switch name, switch MAC, switch port, status (`active`, `inactive`, `unpatched`, `faulty`), and notes. Ports can be added one at a time or imported from CSV with a validated preview, and exported to CSV. CSV columns:

```text
site,jack,room,patchPanel,patchPanelPort,switchName,switchMac,switchPort,status,notes
```

A jack must be unique within its site, and two active ports cannot claim the same switch MAC and port. Network ports are scoped like peripherals: to a device group, or to the whole domain (full administrators only).

Each asset keeps its latest network sighting. When the observed switch MAC and port match an active network port, the asset detail shows the full chain, for example `HazelPC → wall jack 2-14 → patch panel A port 14 → switch BSL-SW1 port 14`. A manager can also record the jack an asset is supposed to use (**Documented jack**). These checks appear with the other review items:

- `network-undocumented` — the asset was seen on a wired switch port that no active network port documents.
- `network-mismatch` — the asset has a documented jack, but its wired switch port resolves to a different jack or none.
- `netport-duplicate-switch-port` — two active network ports claim the same switch port (shown on the Network ports tab).

### Reporting an observation

Sightings come from an external collector, such as an MCP client that reads UniFi client data. The collector needs **Manage inventory** and sends a plugin action over the MeshCentral websocket:

```json
{
  "action": "plugin", "plugin": "inventory", "pluginaction": "network-observe", "requestId": "unifi-1",
  "nodeid": "node//abc123",
  "observation": {
    "mac": "aa:bb:cc:dd:ee:01", "ip": "10.0.0.5", "site": "Office-UDM/Default",
    "connection": "wired", "switchName": "BSL-SW1", "switchMac": "aa:bb:cc:00:00:01", "switchPort": 14,
    "source": "unifi-mcp", "seenAt": "2026-10-21T10:00:00Z"
  }
}
```

Identify the asset with `assetId`, `nodeid`, or `mac` (checked in that order). A MAC is matched against the interfaces MeshCentral agents report, then against MACs the asset was previously observed with. Wireless sightings use `apName`, `apMac`, and `ssid` instead of the switch fields. Audit history is written only when the site, switch, port, or access point changes; otherwise only the sighting time is refreshed. Sightings older than the stored one are ignored.

## How it works

- Hardware and user data come from MeshCentral node, system-information, and agent events. No extra endpoint collector is installed.
- Inventory records are stored in MeshCentral's configured database and remain separate from MeshCentral node records.
- Automatic workstations are matched by hardware identity, so replacing a MeshCentral node ID does not create a new physical asset.
- The plugin synchronizes once after startup, every six hours, when requested manually, and when relevant agent events arrive. It does not poll every second or minute.
- Permissions and device-group visibility are enforced on the server.

## Requirements

- MeshCentral 1.2.5 or later
- MeshCentral plugins enabled

## Install

1. Open **My Server → Plugins**.
2. Select **Download Plugin**.
3. Enter:

   ```text
   https://raw.githubusercontent.com/troymroberts/meshcentral-inventory/main/config.json
   ```

4. Install Inventory, refresh MeshCentral, and select **Synchronize** for the first scan.

## Permissions

- **View inventory** — view records within the user's MeshCentral scope.
- **Manage inventory** — edit lifecycle, assignments, reviews, and manual records.
- **Synchronize inventory** — run a full synchronization.

Permissions are configured from the Inventory entry under **My Server → Plugins**.

## Updates

Use **Upgrade** from the Inventory plugin row when MeshCentral reports a newer version. Updating plugin files does not delete inventory records. Full administrators can download or restore Inventory data from **Inventory settings**.

## Development

```powershell
node --test --test-isolation=none
npm run package        # Linux/macOS (scripts/package.sh)
npm run package:ps     # Windows (scripts/package.ps1)
```

### Releasing (fork)

```bash
npm test && bash scripts/package.sh        # also refreshes release-assets/MeshCentral-Inventory.zip
# bump version + downloadUrl (raw.githubusercontent.com/.../v<version>/release-assets/...) in config.json first
git commit -am "Release v<version>" && git tag -a v<version> -m v<version> && git push origin main v<version>
gh release create v<version> dist/MeshCentral-Inventory.zip --repo troymroberts/meshcentral-inventory --title v<version>
```

`downloadUrl` must serve the zip without a redirect: MeshCentral's plugin downloader drops the query string when it
follows a redirect, so GitHub release-asset URLs (302 to a signed URL) fail with "Error downloading plugin: HTTP 618".
The raw URL of the tag's committed `release-assets/` zip is immutable and served directly.

## License

Apache-2.0
