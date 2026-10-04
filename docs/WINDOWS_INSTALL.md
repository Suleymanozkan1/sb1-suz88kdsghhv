# Windows installation (on-premise)

`HotelCost-Setup-<version>.exe` installs everything a hotel needs on one Windows machine. Nothing else has to be installed first.

| Component | Version | Runs as |
|---|---|---|
| PostgreSQL (embedded build) | 16.14 | Windows service **HotelCostDB** (NetworkService, port 5433, local connections only) |
| Node.js runtime | 22.22 | used by the service below |
| HotelCost web application | this repository, Next.js standalone build | Windows service **HotelCostServer** (WinSW wrapper, auto-restart, port 3000) |

**Requirements:** 64-bit Windows 10/11 or Windows Server 2016+, 4 GB RAM (8 GB recommended), 2 GB free disk plus room for data, and administrator rights for the installation.

## Install

1. Run `HotelCost-Setup-<version>.exe` and accept the administrator prompt.
2. Choose the folder (default `C:\Program Files\HotelCost`).
3. A console window opens and asks for:
   - company name;
   - first hotel name, code, number of rooms and currency;
   - administrator name, e-mail and password (at least 10 characters).
4. Setup creates the database cluster in `C:\ProgramData\HotelCost\pgdata`, applies all migrations, creates the company with standard departments, cost centers, warehouses and categories, registers both services and waits until the application answers.
5. Open **http://localhost:3000** from the desktop shortcut, or **http://<computer-name>:3000** from other PCs on the hotel network. The installer opens TCP 3000 for private and domain networks in Windows Firewall.

Add hotels, users (invitations or direct), departments and warehouses under **Administration**.

## Daily use

The Start menu → HotelCost folder contains:

| Shortcut | Action |
|---|---|
| HotelCost | Opens the application |
| HotelCost - Backup | Stops the services briefly, copies the database to `C:\ProgramData\HotelCost\backups\<timestamp>`, then restarts. Copy that folder off the machine. |
| HotelCost - Start / Stop / Status | Service control |
| HotelCost - Demo data | Loads the 5-company training dataset (several minutes; use a test installation) |

Logs are in `C:\ProgramData\HotelCost\logs`. The configuration (ports, database password, session secret) is in `C:\ProgramData\HotelCost\config.json`, readable by administrators only.

## Upgrade

Run the newer installer over the existing installation. It stops the services, replaces the program files, applies only the new database migrations (Prisma-compatible `_prisma_migrations` bookkeeping), keeps all data and restarts the services.

## Uninstall

Settings → Apps → HotelCost. The uninstaller asks whether to delete the data folder as well. Answer **No** to keep it for a later reinstall.

## Security notes

- PostgreSQL listens on 127.0.0.1 only, with a random password generated at install.
- The web application uses plain HTTP on the LAN. For access from outside the hotel, put it behind a TLS reverse proxy (IIS ARR or nginx). Never expose port 3000 to the internet directly.
- A production installation never contains demo data unless an administrator runs the demo shortcut.

## Building the installer

On Linux, with `makensis` (NSIS 3) installed:

```bash
npm ci
bash installer/build-windows.sh                   # → dist/HotelCost-Setup-<version>.exe (~80 MB)
TARGET=linux bash installer/build-windows.sh      # same layout with Linux binaries, for testing setup
```

The build downloads Node.js (nodejs.org), PostgreSQL (`@embedded-postgres/windows-x64` from npm) and WinSW (`node-windows` from npm), and caches them in `~/.cache/hotelcost-installer`.

## What was tested

The setup program (`installer/setup.ts`) is cross-platform. It was run end to end on Linux with the same embedded PostgreSQL 16:

- cluster creation, 12 migrations and first-company bootstrap;
- web server start and health check, then login and the dashboard (HTTP 200);
- idempotent re-run (upgrade path), backup, status and the demo-data loader;
- uninstall with purge.

The NSIS script compiles into the `.exe`.

**Not tested here:** running the `.exe` on a real Windows machine (no Windows in CI). The Windows-only steps are `pg_ctl register` / `sc start`, the WinSW service, `icacls` for NetworkService, the firewall rule and the shortcuts. Please run the installer once on a test PC before rolling it out.
