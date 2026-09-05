#!/usr/bin/env bash
# Deploy AutomaEyes web ke hosting lewat FTP/FTPS.
#
# Pakai curl (mendukung ftp/ftps) karena lftp/ncftp tidak tersedia di mesin ini.
# Kredensial dibaca dari deploy/.env.deploy yang sudah di-gitignore.
#
#   ./deploy/deploy.sh            # upload berkas yang terdaftar di bawah
#   ./deploy/deploy.sh --dry-run  # tampilkan rencana saja, tidak mengunggah
#   ./deploy/deploy.sh --verify   # hanya cek endpoint di server, tanpa upload
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env.deploy"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE belum ada."
    echo "       Salin deploy/env.deploy.contoh jadi deploy/.env.deploy lalu isi kredensialnya."
    exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${FTP_HOST:?FTP_HOST belum diisi}"
: "${FTP_USER:?FTP_USER belum diisi}"
: "${FTP_PASS:?FTP_PASS belum diisi}"
FTP_PORT="${FTP_PORT:-21}"
FTP_TLS="${FTP_TLS:-1}"
REMOTE_PUBLIC="${REMOTE_PUBLIC:-/public_html}"
REMOTE_SRC="${REMOTE_SRC:-/src}"
SITE_URL="${SITE_URL:-https://automaeyes.my.id}"

DRY_RUN=0; VERIFY_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --verify)  VERIFY_ONLY=1 ;;
        *) echo "Argumen tak dikenal: $arg"; exit 1 ;;
    esac
done

# Daftar berkas: "<path lokal relatif>|<folder remote>"
# Tambah baris di sini kalau ada berkas baru yang perlu naik.
FILES=(
    # Alur login aplikasi desktop
    "public/login.php|$REMOTE_PUBLIC"
    "public/logout.php|$REMOTE_PUBLIC"
    "public/signup.php|$REMOTE_PUBLIC"
    "public/auth/callback.php|$REMOTE_PUBLIC/auth"
    "public/auth/handoff.php|$REMOTE_PUBLIC/auth"
    "public/api/verify.php|$REMOTE_PUBLIC/api"
    "public/api/github-token.php|$REMOTE_PUBLIC/api"
    "public/auth/github.php|$REMOTE_PUBLIC/auth"
    "src/lib/OAuth.php|$REMOTE_SRC/lib"
    "src/lib/Auth.php|$REMOTE_SRC/lib"
    "src/lib/helpers.php|$REMOTE_SRC/lib"

    # Halaman publik & unduhan
    "public/index.php|$REMOTE_PUBLIC"
    "public/welcome.php|$REMOTE_PUBLIC"
    "public/download.php|$REMOTE_PUBLIC"
    "public/api/version.php|$REMOTE_PUBLIC/api"
    "src/bootstrap.php|$REMOTE_SRC"
    "src/lib/Release.php|$REMOTE_SRC/lib"
    "src/includes/header.php|$REMOTE_SRC/includes"
    "src/includes/footer.php|$REMOTE_SRC/includes"

    # Pemulihan kata sandi
    "public/forgot-password.php|$REMOTE_PUBLIC"
    "public/reset-password.php|$REMOTE_PUBLIC"
    "src/lib/Mailer.php|$REMOTE_SRC/lib"

    # Aset front-end.
    # Wajib ikut: halaman dan asetnya saling bergantung. Menaikkan index.php
    # tanpa story.js/style.css pernah menyisakan animasi pembuka lama yang
    # mengunci scroll pada halaman yang sudah tidak punya overlay-nya.
    "public/assets/css/style.css|$REMOTE_PUBLIC/assets/css"
    "public/assets/js/story.js|$REMOTE_PUBLIC/assets/js"
    "public/assets/js/scene.js|$REMOTE_PUBLIC/assets/js"
    "public/assets/js/story3d.js|$REMOTE_PUBLIC/assets/js"
)

upload() {
    local local_rel="$1" remote_dir="$2"
    local local_path="$ROOT/$local_rel"
    local name; name="$(basename "$local_rel")"
    local url="ftp://$FTP_HOST:$FTP_PORT$remote_dir/$name"

    if [ ! -f "$local_path" ]; then
        echo "  LEWAT (tidak ada): $local_rel"
        return 1
    fi
    if [ "$DRY_RUN" = "1" ]; then
        echo "  [dry-run] $local_rel  ->  $remote_dir/$name"
        return 0
    fi

    # -k: sertifikat server dikeluarkan untuk hostname server, bukan untuk
    # domain ini (lumrah di shared hosting), jadi verifikasi nama gagal.
    # Koneksi tetap terenkripsi TLS — hanya pencocokan nama yang dilewati.
    local tls_opt=()
    [ "$FTP_TLS" = "1" ] && tls_opt=(--ssl-reqd -k)

    # --ftp-create-dirs membuat folder yang belum ada (mis. public_html/api).
    if curl -sS --fail-with-body "${tls_opt[@]}" \
            --ftp-create-dirs \
            -u "$FTP_USER:$FTP_PASS" \
            -T "$local_path" "$url" 2>/tmp/ftp_err; then
        echo "  OK  $local_rel  ->  $remote_dir/$name"
        return 0
    else
        echo "  GAGAL $local_rel : $(tr -d '\r' < /tmp/ftp_err | tail -2 | tr '\n' ' ')"
        return 1
    fi
}

verify() {
    echo
    echo "Verifikasi di server:"
    # Tanpa token harus balas JSON 400 (bukan 404). 404 = file belum naik.
    local code body
    code="$(curl -s -o /tmp/verify_body -w '%{http_code}' "$SITE_URL/api/verify.php" || echo 000)"
    body="$(cat /tmp/verify_body 2>/dev/null | head -c 200)"
    echo "  GET /api/verify.php -> HTTP $code"
    echo "     $body"
    case "$code" in
        400) echo "  ✓ endpoint hidup (400 = token kosong, sesuai harapan)" ;;
        404) echo "  ✗ masih 404 — berkas belum sampai, cek REMOTE_PUBLIC" ;;
        *)   echo "  ? balasan tak terduga — cek manual" ;;
    esac
}

echo "Target : $FTP_HOST:$FTP_PORT (TLS=$FTP_TLS)"
echo "Public : $REMOTE_PUBLIC"
echo "Src    : $REMOTE_SRC"
echo

if [ "$VERIFY_ONLY" = "1" ]; then
    verify
    exit 0
fi

fail=0
echo "Mengunggah:"
for entry in "${FILES[@]}"; do
    upload "${entry%%|*}" "${entry##*|}" || fail=1
done

[ "$DRY_RUN" = "1" ] && { echo; echo "(dry-run: tidak ada yang diunggah)"; exit 0; }

verify
exit $fail
