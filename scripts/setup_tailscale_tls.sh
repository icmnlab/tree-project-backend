#!/bin/bash
# ============================================================
# setup_tailscale_tls.sh — 讓手機端以「有效 TLS 憑證」連線後端
# ============================================================
# 背景：
#   Android 預設拒絕自簽憑證。若 App 的 API_BASE_URL 指向自簽憑證主機
#   （例如 https://<IP>/api），會出現 CERTIFICATE_VERIFY_FAILED，所有 API 連不上。
#   本腳本用 Tailscale 免費自動憑證（*.ts.net），讓 nginx 同時對 ts.net 名稱
#   提供受信任憑證，保留 nginx 的速率限制與安全標頭（優於 tailscale serve）。
#
# 使用方式（需 sudo）：
#   sudo bash scripts/setup_tailscale_tls.sh                 # 自動偵測本機 ts.net 名稱
#   sudo bash scripts/setup_tailscale_tls.sh <name>.<tailnet>.ts.net  # 指定名稱
#
# 交接到機構機器時：建議改用機構網域 + Let's Encrypt（certbot），不需本腳本。
# ============================================================
set -euo pipefail

SSL_DIR="/opt/tree-app/ssl"
NGINX_CONF="/etc/nginx/sites-enabled/tree-app"
CERT_FILE="$SSL_DIR/ts.crt"
KEY_FILE="$SSL_DIR/ts.key"

if [ "$(id -u)" -ne 0 ]; then
    echo "請用 sudo 執行：sudo bash $0" >&2
    exit 1
fi

# 1) 取得 ts.net 名稱
TS_NAME="${1:-}"
if [ -z "$TS_NAME" ]; then
    # 注意：在 set -o pipefail 下，`grep | head` 因 head 先關閉管線會讓 grep 收到 SIGPIPE，
    # 使整條 pipeline 回非零 → set -e 會讓腳本「無聲中止」。以 || true 保護自動偵測。
    TS_NAME=$(tailscale status --json | grep -oE '"DNSName":"[^"]+"' | head -1 | sed 's/"DNSName":"//;s/"//;s/\.$//' || true)
fi
if [ -z "$TS_NAME" ]; then
    echo "無法自動偵測 ts.net 名稱，請手動指定：sudo bash $0 <name>.<tailnet>.ts.net" >&2
    exit 1
fi
echo "使用 ts.net 名稱：$TS_NAME"

# 2) 產生 / 更新 Tailscale 憑證（約 90 天有效）
mkdir -p "$SSL_DIR"
echo "產生 Tailscale 憑證 → $CERT_FILE / $KEY_FILE"
tailscale cert --cert-file "$CERT_FILE" --key-file "$KEY_FILE" "$TS_NAME"

# 3) 修改 nginx：server_name 加上 ts.net 名稱、ssl_certificate 指向 ts 憑證
if [ ! -f "$NGINX_CONF" ]; then
    echo "找不到 nginx 設定：$NGINX_CONF（請手動調整）" >&2
    exit 1
fi
# 備份「不可」放在 sites-enabled/ 內：nginx 會 include 該資料夾所有檔案，
# 造成 server_name 重複（conflicting server name + server_names_hash 失敗）。
BACKUP_DIR="/opt/tree-app/nginx-conf-backups"
mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/tree-app.bak.$(date +%Y%m%d%H%M%S)"
cp "$NGINX_CONF" "$BACKUP"
echo "已備份 nginx 設定 → $BACKUP"

# server_name：若尚未含 ts.net 名稱則補上（保留既有 IP/名稱）
if ! grep -q "$TS_NAME" "$NGINX_CONF"; then
    sed -i -E "s|(^\s*server_name\s+)(.*)(;)|\1$TS_NAME \2\3|" "$NGINX_CONF"
fi
# ssl_certificate / key 指向 ts 憑證
sed -i -E "s|(^\s*ssl_certificate\s+).*(;)|\1$CERT_FILE\2|" "$NGINX_CONF"
sed -i -E "s|(^\s*ssl_certificate_key\s+).*(;)|\1$KEY_FILE\2|" "$NGINX_CONF"

# 4) 測試並重載；失敗則回滾
if nginx -t; then
    systemctl reload nginx
    echo "nginx 已重載，現在 https://$TS_NAME/ 使用受信任憑證。"
else
    echo "nginx -t 失敗，回滾設定。" >&2
    cp "$BACKUP" "$NGINX_CONF"
    exit 1
fi

# 5) 設定 90 天自動續期（每月 3 號 03:17 重跑本腳本）
CRON_LINE="17 3 3 * * root /usr/bin/env bash $(readlink -f "$0") $TS_NAME >> /opt/tree-app/logs/tls_renew.log 2>&1"
CRON_FILE="/etc/cron.d/tree-tls-renew"
echo "$CRON_LINE" > "$CRON_FILE"
chmod 644 "$CRON_FILE"
echo "已設定自動續期 cron → $CRON_FILE"

echo ""
echo "完成。請以此網址建置 App："
echo "  flutter build apk --release --dart-define=API_BASE_URL=https://$TS_NAME/api"
echo "驗證（不要加 -k）：curl https://$TS_NAME/api/health"
