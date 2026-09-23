#!/bin/sh
# Start the leased GPU sandbox.
#
# LEASE_SSH_PASSWORD is generated per lease by the provider agent and passed in
# as an environment variable. Refuse to start without one rather than exposing a
# shell with a default or empty credential.
set -eu

if [ -z "${LEASE_SSH_PASSWORD:-}" ]; then
  echo "[lease] refusing to start: LEASE_SSH_PASSWORD is not set" >&2
  exit 1
fi

echo "root:${LEASE_SSH_PASSWORD}" | chpasswd

# Host keys are per container, so each lease presents a distinct fingerprint.
ssh-keygen -A >/dev/null

cat <<BANNER >/etc/motd
ShaderMesh leased GPU sandbox
Lease:  ${LEASE_ID:-unknown}
This container is metered on chain. Escrow streams to the provider for every
interval it proves it served, and stops when the lease ends.
BANNER

if command -v nvidia-smi >/dev/null 2>&1; then
  echo "[lease] GPU visible to this container:"
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader || true
else
  echo "[lease] no GPU attached to this container"
fi

echo "[lease] sshd listening on 22 for lease ${LEASE_ID:-unknown}"
exec /usr/sbin/sshd -D -e
