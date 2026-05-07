const { Client, LocalAuth } = require('whatsapp-web.js');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// Minta input nomor HP di terminal kalau belum ada di config
async function getNomorWA() {
  const cfg = loadConfig();
  if (cfg.nomorWA) return cfg.nomorWA;

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('📱 Masukkan nomor WA kamu (format: 628xxxxxxxx): ', (nomor) => {
      rl.close();
      nomor = nomor.trim().replace(/\D/g, '');
      cfg.nomorWA = nomor;
      saveConfig(cfg);
      resolve(nomor);
    });
  });
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

let myNumber = '';
let isBroadcasting = false;

// ─── PAIRING CODE (ganti QR) ───
client.on('qr', async () => {
  try {
    const nomor = await getNomorWA();
    const code = await client.requestPairingCode(nomor);
    console.log('\n┌─────────────────────────────┐');
    console.log(`│  🔑 PAIRING CODE: ${code}  │`);
    console.log('└─────────────────────────────┘');
    console.log('\n📲 Cara pakai kode ini:');
    console.log('   1. Buka WhatsApp di HP kamu');
    console.log('   2. Titik tiga → Perangkat Tertaut');
    console.log('   3. Tautkan Perangkat → Tautkan dengan nomor HP');
    console.log('   4. Masukkan kode di atas\n');
  } catch (err) {
    console.error('❌ Gagal dapat pairing code:', err.message);
  }
});

client.on('authenticated', () => {
  console.log('✅ Login berhasil! Sesi disimpan.');
});

// ─── READY: auto-simpan owner ───
client.on('ready', async () => {
  myNumber = client.info.wid._serialized;

  const cfg = loadConfig();
  if (!cfg.ownerNumber) {
    cfg.ownerNumber = myNumber;
    saveConfig(cfg);
    console.log(`🔐 Owner terdaftar: ${client.info.wid.user}`);
  } else {
    console.log(`🔐 Owner: ${client.info.wid.user}`);
  }

  console.log('🚀 Bot siap digunakan!');
  console.log('💬 Kirim ".nanz" di WA kamu untuk lihat menu.\n');
});

client.on('auth_failure', () => {
  console.error('❌ Gagal login. Hapus folder .wwebjs_auth lalu coba lagi.');
  process.exit(1);
});

client.on('disconnected', (reason) => {
  console.log('⚠️  Bot terputus:', reason);
  process.exit(1);
});

// ─── LISTENER COMMAND ───
client.on('message_create', async (msg) => {
  const cfg = loadConfig();

  // 🔐 Owner lock
  const owner = cfg.ownerNumber || myNumber;
  const sender = msg.author || msg.from;
  if (sender !== owner) return;

  if (isBroadcasting) {
    await msg.reply('⏳ Broadcast sedang berjalan, tunggu sampai selesai ya...');
    return;
  }

  const body = msg.body.trim();
  if (!body.startsWith('.')) return;

  const [cmd, ...args] = body.split(' ');
  const argStr = args.join(' ');

  switch (cmd.toLowerCase()) {

    case '.nanz': {
      await msg.reply(
`╔══════════════════════╗
║   🤖 *BOT BROADCAST*   ║
╚══════════════════════╝

📝 *PESAN*
  *.setpesan* [teks]
  → Ganti isi pesan broadcast
  → Gunakan \\n untuk baris baru
  → _Contoh: .setpesan Halo kak!\\nPromo hari ini 🔥_

⏱ *JEDA*
  *.setjeda* [min] [max]
  → Atur jeda antar kirim (detik)
  → _Contoh: .setjeda 20 60_

📊 *INFO & AKSI*
  *.listgrup* — lihat semua grup
  *.status* — lihat setting sekarang
  *.broadcast* — kirim ke semua grup
  *.nanz* — tampilkan menu ini

🔐 _Hanya kamu yang bisa pakai bot ini_`
      );
      break;
    }

    case '.setpesan': {
      if (!argStr) {
        await msg.reply('❌ Teks tidak boleh kosong.\n\n_Contoh: .setpesan Halo kak!\\nCek promo hari ini 🔥_');
        break;
      }
      cfg.pesan = argStr;
      saveConfig(cfg);
      const preview = argStr.replace(/\\n/g, '\n');
      await msg.reply(`✅ Pesan diupdate!\n\n📝 *Preview:*\n${preview}`);
      break;
    }

    case '.setjeda': {
      const min = parseInt(args[0]);
      const max = parseInt(args[1]);
      if (isNaN(min) || isNaN(max) || min < 5 || max < min) {
        await msg.reply('❌ Format salah.\n\n_Contoh: .setjeda 20 60_\n_(minimal 5 detik, max ≥ min)_');
        break;
      }
      cfg.jedaMin = min;
      cfg.jedaMax = max;
      saveConfig(cfg);
      await msg.reply(`✅ Jeda diupdate!\n\n⏱ *Jeda:* ${min}–${max} detik`);
      break;
    }

    case '.listgrup': {
      const chats = await client.getChats();
      const groups = chats.filter(c => c.isGroup);
      if (groups.length === 0) {
        await msg.reply('❌ Tidak ada grup yang ditemukan.');
        break;
      }
      let list = `👥 *Semua grup (${groups.length}) — semua akan dikirim:*\n`;
      groups.forEach((g, i) => { list += `\n${i + 1}. ${g.name}`; });
      await msg.reply(list);
      break;
    }

    case '.status': {
      const pesanRaw = cfg.pesan || '-';
      const preview = pesanRaw.replace(/\\n/g, '\n').substring(0, 150);
      await msg.reply(
`📊 *STATUS BOT*

📝 *Pesan (preview):*
_${preview}${pesanRaw.length > 150 ? '...' : ''}_

⏱ *Jeda:* ${cfg.jedaMin}–${cfg.jedaMax} detik
👥 *Target:* Semua grup yang kamu join`
      );
      break;
    }

    case '.broadcast': {
      const chats = await client.getChats();
      const groups = chats.filter(c => c.isGroup);
      if (groups.length === 0) {
        await msg.reply('❌ Tidak ada grup yang ditemukan.');
        break;
      }
      const pesan = (cfg.pesan || '').replace(/\\n/g, '\n');
      if (!pesan.trim()) {
        await msg.reply('❌ Pesan belum diisi!\n\nGunakan _.setpesan [teks]_ dulu ya.');
        break;
      }
      await msg.reply(
`🚀 *Broadcast dimulai!*
👥 Jumlah grup: *${groups.length}*
⏱ Jeda: *${cfg.jedaMin}–${cfg.jedaMax} detik*

_Laporan dikirim setelah selesai._`
      );
      isBroadcasting = true;
      let sukses = 0, gagal = 0;
      for (let i = 0; i < groups.length; i++) {
        try {
          await groups[i].sendMessage(pesan);
          sukses++;
          console.log(`✅ [${i+1}/${groups.length}] ${groups[i].name}`);
        } catch (err) {
          gagal++;
          console.error(`❌ Gagal: ${groups[i].name}`);
        }
        if (i < groups.length - 1) {
          const delay = randomDelay(cfg.jedaMin, cfg.jedaMax);
          console.log(`   ⏳ Jeda ${(delay/1000).toFixed(1)}s...`);
          await sleep(delay);
        }
      }
      isBroadcasting = false;
      await msg.reply(`🎉 *Broadcast selesai!*\n\n✅ Berhasil: ${sukses} grup\n❌ Gagal: ${gagal} grup`);
      break;
    }

    default:
      await msg.reply('❓ Command tidak dikenal.\n\nKetik *.nanz* untuk lihat semua menu.');
  }
});

function randomDelay(minSec, maxSec) {
  return Math.floor(Math.random() * ((maxSec - minSec) * 1000 + 1)) + minSec * 1000;
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

client.initialize();
