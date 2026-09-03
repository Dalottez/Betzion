# Sanitized distribution

This repository contains the Aviator frontend source only.

Excluded intentionally:

- All backend/server code
- Payment gateway, M-Pesa, ArchPay, callback, and webhook logic. The
  remaining payment service entry points are intentionally disabled and make
  no payment requests.
- Database code, connection settings, snapshots, user records, and backups
- Deployment configuration, build output, and installed dependencies
- Production API configuration and credentials

The frontend API target is deliberately set to `http://localhost:3022`. Replace it only with a new backend you control.
