HotelCost - on-premise installation
===================================

After setup the application runs as two Windows services that start with the computer:
  HotelCostDB      PostgreSQL 16 database (local only, port 5433)
  HotelCostServer  HotelCost web application (port 3000)

Open:      http://localhost:3000   (other computers on the hotel network: http://<this-computer-name>:3000)
Data:      C:\ProgramData\HotelCost  (database, logs, backups, config.json - keep this folder backed up)

Start menu shortcuts
  HotelCost                 open the application
  HotelCost - Backup        consistent copy of the database into C:\ProgramData\HotelCost\backups
  HotelCost - Demo data     loads 5 demo companies / 10 hotels for training (several minutes)
  HotelCost - Start / Stop  start or stop both services

Upgrades: run the newer installer over the existing one. Your data is kept; new database
migrations are applied automatically.

Security: the web server listens on the local network over HTTP. For access from outside the
hotel, put it behind a TLS reverse proxy (IIS/nginx) and do not expose port 3000 directly.
Windows Firewall will ask once whether to allow port 3000 on private networks.

Uninstall: Settings > Apps > HotelCost. The data folder is kept unless you tick
"Delete all HotelCost data" in the uninstaller.
