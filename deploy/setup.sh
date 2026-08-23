#!/usr/bin/env bash
# Setup do Painel UnitV - Ubuntu (Oracle Cloud)
set -e

echo "==> [1/4] Instalando Docker..."
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl unzip
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
fi

echo "==> [2/4] Swap (caso a VM tenha pouca RAM, para compilar o SQLite)..."
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 2000 ] && [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

echo "==> [3/4] Liberando portas 80 e 443 no firewall da instancia..."
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo sh -c 'iptables-save > /etc/iptables/rules.v4'

echo "==> [4/4] Construindo e subindo o painel (3-6 min na primeira vez)..."
cd "$(dirname "$0")"
sudo docker compose -f docker-compose.prod.yml up -d --build

sleep 5
echo ""
echo "=============================================="
echo " Status:"
sudo docker compose -f docker-compose.prod.yml ps
echo ""
echo " Painel:  https://unitvrecarga.com.br"
echo " Admin:   admin@painel.com / admin123"
echo " Webhook MP: https://unitvrecarga.com.br/api/pay/webhook"
echo " Logs:    sudo docker compose -f docker-compose.prod.yml logs -f"
echo "=============================================="
