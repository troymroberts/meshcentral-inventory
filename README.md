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
