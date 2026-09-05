; Prasyarat saat pemasangan.
;
; Pembagian tugas:
;   di sini    : memastikan Python ADA, memasangnya sendiri kalau belum
;                (unduhan ~25 MB, senyap, tanpa campur tangan pengguna)
;   aplikasi   : memasang paket Python di halaman Persiapan
;
; Paketnya (ultralytics menarik torch, lebih dari 1 GB) sengaja TIDAK diurus
; di sini. Ukurannya membengkakkan installer, dan unduhan sebesar itu di dalam
; installer yang tidak bisa menampilkan progres per-paket akan terlihat
; menggantung lalu gagal tanpa penjelasan. Di aplikasi, prosesnya bisa
; ditampilkan, diulang, dan dibatalkan.
;
; Node.js tidak diperiksa: aplikasi ini membawa runtime-nya sendiri lewat
; Electron. Tidak ada yang perlu dipasang untuk itu.

!macro customCheckAppRunning
!macroend

!macro customInstall
  DetailPrint "Memeriksa Python..."

  ; nsExec menjalankan tanpa membuka jendela konsol.
  nsExec::ExecToStack '"$SYSDIR\cmd.exe" /c python --version'
  Pop $0   ; kode keluar
  Pop $1   ; keluaran

  ${If} $0 == 0
    DetailPrint "Python terdeteksi: $1"
    Goto pythonSelesai
  ${EndIf}

  ; py launcher dipakai kalau python.exe tidak ada di PATH.
  nsExec::ExecToStack '"$SYSDIR\cmd.exe" /c py --version'
  Pop $0
  Pop $1
  ${If} $0 == 0
    DetailPrint "Python terdeteksi lewat py launcher: $1"
    Goto pythonSelesai
  ${EndIf}

  DetailPrint "Python tidak ditemukan."
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Python belum ada di komputer ini.$\r$\n$\r$\nAutomaEyes memerlukannya untuk melatih dan menjalankan model AI.$\r$\n$\r$\nPasang sekarang secara otomatis? (unduhan sekitar 25 MB)$\r$\n$\r$\nKalau dilewati, AutomaEyes tetap terpasang dan bisa memasangnya nanti saat pertama dibuka." \
    IDNO pythonDilewati

  DetailPrint "Mengunduh Python 3.12.7..."
  ; PowerShell dipakai untuk mengunduh supaya tidak perlu plugin NSIS tambahan.
  ; Tls12 disebut eksplisit: Windows lama menawarkan TLS 1.0 lebih dulu, dan
  ; python.org menolaknya - gejalanya unduhan gagal tanpa alasan yang jelas.
  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; $$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile '$TEMP\automaeyes-python.exe' -UseBasicParsing"`
  Pop $0

  ${If} $0 != 0
    DetailPrint "Unduhan Python gagal (kode $0)."
    MessageBox MB_OK|MB_ICONINFORMATION \
      "Unduhan Python gagal.$\r$\n$\r$\nAutomaEyes tetap terpasang. Buka aplikasinya, dan di halaman Persiapan tekan Pasang semua otomatis untuk mencoba lagi."
    Goto pythonSelesai
  ${EndIf}

  DetailPrint "Memasang Python (senyap)..."
  ; InstallAllUsers=0 supaya tidak menuntut hak administrator - installer
  ; AutomaEyes sendiri juga per-pengguna, jadi meminta UAC di sini hanya
  ; menambah satu dinding lagi tanpa alasan.
  ; PrependPath=1 supaya "python" langsung dikenali setelahnya.
  ExecWait '"$TEMP\automaeyes-python.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_launcher=1 AssociateFiles=0 Shortcuts=0' $0
  Delete "$TEMP\automaeyes-python.exe"

  ${If} $0 == 0
    DetailPrint "Python terpasang."
  ${ElseIf} $0 == 3010
    DetailPrint "Python terpasang (komputer perlu di-restart)."
  ${Else}
    DetailPrint "Pemasang Python berhenti dengan kode $0."
    MessageBox MB_OK|MB_ICONINFORMATION \
      "Pemasangan Python tidak selesai (kode $0).$\r$\n$\r$\nAutomaEyes tetap terpasang. Buka aplikasinya, dan di halaman Persiapan tekan Pasang semua otomatis untuk mencoba lagi."
  ${EndIf}
  Goto pythonSelesai

  pythonDilewati:
  DetailPrint "Pemasangan Python dilewati. Aplikasi akan menawarkannya lagi saat pertama dibuka."

  pythonSelesai:
!macroend
