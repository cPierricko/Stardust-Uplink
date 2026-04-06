#!/bin/bash

# Stardust Docker & Infra provisioning script
set -e

echo "[+] Starting VPS Provisioning Script..."

# Check if we have sudo or if we are root
if [ "$(id -u)" -ne 0 ]; then
  echo "[!] Not running as root. Checking for passwordless sudo..."
  if ! sudo -n true 2>/dev/null; then
    echo "[!] ERROR: This script requires root or passwordless sudo privileges."
    echo "    Please add NOPASSWD for this user in visudo, or run as root."
    exit 1
  fi
  SUDO="sudo"
else
  SUDO=""
fi

# 1. Install Docker if missing
if ! command -v docker &> /dev/null; then
    echo "[+] Docker not found. Installing via get.docker.com..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    $SUDO sh get-docker.sh
    rm get-docker.sh
    echo "[+] Docker installed successfully."
else
    echo "[+] Docker is already installed."
fi

# 2. Add current user to Docker group
USER_NAME=$(whoami)
if ! groups "$USER_NAME" | grep -q '\bdocker\b'; then
    echo "[+] Adding user $USER_NAME to docker group..."
    $SUDO usermod -aG docker "$USER_NAME"
    echo "[+] User added to docker group. Note: A session restart might be required for some changes to take effect."
else
    echo "[+] User $USER_NAME is already in docker group."
fi

# 3. Create stardust_internal network
echo "[+] Validating network stardust_internal..."
if ! $SUDO docker network ls | awk '{print $2}' | grep -wq "stardust_internal"; then
    echo "[+] Network stardust_internal not found. Creating..."
    $SUDO docker network create --driver bridge stardust_internal
    echo "[+] Network stardust_internal created."
else
    echo "[+] Network stardust_internal already exists."
fi

# 4. Create directories /storage/apps and /storage/logs
echo "[+] Validating storage directories..."
$SUDO mkdir -p /storage/apps
$SUDO mkdir -p /storage/logs
$SUDO chown -R "$USER_NAME":"$USER_NAME" /storage
echo "[+] Storage directories exist and ownership is correct."

echo "[+] VPS Provisioning completed successfully!"
