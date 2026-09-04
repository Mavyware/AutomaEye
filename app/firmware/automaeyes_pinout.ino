/*
 * AutomaEyes — penerima sinyal per kelas
 * ---------------------------------------
 * Unggah sketsa ini ke papan Arduino atau ESP32 yang dipilih di halaman
 * Output. Setelah itu tiap kelas yang terdeteksi akan menggerakkan pin
 * sesuai pemetaan yang Anda atur di aplikasi.
 *
 * Yang diterima, satu baris per siklus inspeksi:
 *
 *     PINS 7=1,8=0,9=0,10=1\n
 *
 * Artinya: pin 7 dan 10 dinyalakan, pin 8 dan 9 dipadamkan. Seluruh pin
 * yang dipetakan selalu ikut dikirim - termasuk yang padam - supaya keadaan
 * siklus sebelumnya tidak menempel.
 *
 * Papan membalas "OK" (atau "ERR <alasan>") untuk memudahkan diagnosa.
 * Balasan ini tidak ditunggu aplikasi, jadi tidak memperlambat lini.
 *
 * Pin analog Arduino ditulis A0..A7 dan tetap dipakai sebagai keluaran
 * digital biasa.
 *
 * Baud harus sama dengan yang dipilih di halaman Output:
 *   Arduino  9600      ESP32  115200
 */

// Samakan dengan baud di halaman Output.
#if defined(ESP32)
  const long BAUD = 115200;
#else
  const long BAUD = 9600;
#endif

// Berapa lama menunggu satu baris utuh sebelum menyerah (milidetik).
const unsigned long BATAS_BARIS_MS = 200;

String buffer;

// Ubah "7" atau "A0" jadi nomor pin yang dimengerti papan.
// Mengembalikan -1 kalau tidak dikenali.
int uraikanPin(const String &teks) {
  String t = teks;
  t.trim();
  if (t.length() == 0) return -1;

#if !defined(ESP32)
  // Pin analog hanya ada penamaannya di papan AVR (Uno/Nano/Mega/Leonardo).
  if (t[0] == 'A' || t[0] == 'a') {
    int n = t.substring(1).toInt();
    switch (n) {
      case 0: return A0;  case 1: return A1;  case 2: return A2;  case 3: return A3;
      case 4: return A4;  case 5: return A5;
      #if defined(A6)
      case 6: return A6;
      #endif
      #if defined(A7)
      case 7: return A7;
      #endif
      default: return -1;
    }
  }
#endif

  for (unsigned int i = 0; i < t.length(); i++) {
    if (!isDigit(t[i])) return -1;
  }
  return t.toInt();
}

// Terapkan satu pasangan "pin=nilai".
bool terapkan(const String &pasangan) {
  int sama = pasangan.indexOf('=');
  if (sama < 0) return false;

  int pin = uraikanPin(pasangan.substring(0, sama));
  if (pin < 0) return false;

  String nilaiTeks = pasangan.substring(sama + 1);
  nilaiTeks.trim();
  if (nilaiTeks != "0" && nilaiTeks != "1") return false;

  // pinMode dipanggil tiap kali, bukan sekali di setup: pemetaan pin bisa
  // diubah dari aplikasi kapan saja tanpa perlu mengunggah ulang sketsa.
  pinMode(pin, OUTPUT);
  digitalWrite(pin, nilaiTeks == "1" ? HIGH : LOW);
  return true;
}

void tanganiBaris(String baris) {
  baris.trim();
  if (baris.length() == 0) return;

  if (!baris.startsWith("PINS")) {
    // Perintah lain dibiarkan lewat tanpa suara. Aplikasi ini juga memakai
    // jalur serial yang sama untuk sinyal OK/NG lama ("0"/"1") dan handshake,
    // jadi membalas ERR untuk semuanya hanya akan mengotori log.
    return;
  }

  String isi = baris.substring(4);
  isi.trim();
  if (isi.length() == 0) { Serial.println("ERR kosong"); return; }

  int gagal = 0, berhasil = 0;
  int mulai = 0;
  while (mulai <= (int)isi.length()) {
    int koma = isi.indexOf(',', mulai);
    String bagian = (koma < 0) ? isi.substring(mulai) : isi.substring(mulai, koma);
    if (bagian.length() > 0) {
      if (terapkan(bagian)) berhasil++; else gagal++;
    }
    if (koma < 0) break;
    mulai = koma + 1;
  }

  if (gagal > 0) {
    Serial.print("ERR ");
    Serial.print(gagal);
    Serial.println(" pin tidak dikenali");
  } else {
    Serial.print("OK ");
    Serial.println(berhasil);
  }
}

void setup() {
  Serial.begin(BAUD);
  buffer.reserve(128);
  // Beri tahu keadaan awal supaya terlihat di Serial Monitor bahwa sketsa
  // yang benar sudah berjalan.
  delay(200);
  Serial.println("AutomaEyes pinout siap");
}

void loop() {
  static unsigned long mulaiBaris = 0;

  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (buffer.length() > 0) {
        tanganiBaris(buffer);
        buffer = "";
      }
      mulaiBaris = 0;
    } else {
      if (buffer.length() == 0) mulaiBaris = millis();
      if (buffer.length() < 200) buffer += c;
      // Baris kelewat panjang berarti ada yang salah di jalurnya; dibuang
      // supaya tidak menahan perintah berikutnya selamanya.
      else { buffer = ""; Serial.println("ERR baris kepanjangan"); }
    }
  }

  // Baris yang datang separuh lalu berhenti (kabel tercabut saat kirim)
  // tidak boleh menyumbat buffer sampai papan di-reset.
  if (buffer.length() > 0 && mulaiBaris > 0 && millis() - mulaiBaris > BATAS_BARIS_MS) {
    buffer = "";
    mulaiBaris = 0;
  }
}
