require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { Client, GatewayIntentBits, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CookieJar } = require('tough-cookie');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const GROUP_ID = "";
const LOG_SINCE_FILE = "group_log_since.txt";

const CHANNEL_INSTANCE_OPEN = "";
const CHANNEL_INSTANCE_CLOSE = "";
const CHANNEL_INVITE = "";
const CHANNEL_JOIN = "";
const ACTION_CHANNEL_MAP = {
  warn: "",
  kick: "",
  ban: "",
};

let _logSince = null;
const jar = new CookieJar();
const axiosInstance = axios.create({
  baseURL: 'https://api.vrchat.cloud/api/1',
  jar,
  withCredentials: true,
  headers: {
    'User-Agent': 'vrchat-discord-bot/1.0.0 hugo@uwu.ceo',
  },
});

axiosInstance.interceptors.request.use(async (config) => {
  const cookieString = await new Promise((resolve, reject) =>
    jar.getCookieString('https://api.vrchat.cloud', {}, (err, cookies) =>
      err ? reject(err) : resolve(cookies)
    )
  );

  if (cookieString) {
    config.headers['Cookie'] = cookieString;
  }

  return config;
});



const readline = require('readline');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function loginVRChat() {
  try {
    // Étape 1 : Auth de base
    const resp = await axiosInstance.get('/auth/user', {
      auth: {
        username: process.env.VRCHAT_USERNAME,
        password: process.env.VRCHAT_PASSWORD
      }
    });

    const cookies = resp.headers['set-cookie'];
    if (cookies) {
      for (const cookie of cookies) {
        await new Promise((res, rej) =>
          jar.setCookie(cookie, 'https://api.vrchat.cloud', {}, err => err ? rej(err) : res())
        );
      }
    }

    const user = resp.data;
    const twoFA = user.requiresTwoFactorAuth;

    // Étape 2 : gestion du 2FA
    if (twoFA?.includes('emailOtp')) {
      const code = await prompt('[VRChat] Code 2FA Email : ');
      const verifyResp = await axiosInstance.post('/auth/twofactorauth/emailotp/verify', { code });

      const verifyCookies = verifyResp.headers['set-cookie'];
      if (verifyCookies) {
        for (const cookie of verifyCookies) {
          await new Promise((res, rej) =>
            jar.setCookie(cookie, 'https://api.vrchat.cloud', {}, err => err ? rej(err) : res())
          );
        }
      }

      console.log('[VRChat] 2FA Email validé.');
    }

    if (twoFA?.includes('totp')) {
      const code = await prompt('[VRChat] Code 2FA TOTP : ');
      const verifyResp = await axiosInstance.post('/auth/twofactorauth/verify', { code });

      const verifyCookies = verifyResp.headers['set-cookie'];
      if (verifyCookies) {
        for (const cookie of verifyCookies) {
          await new Promise((res, rej) =>
            jar.setCookie(cookie, 'https://api.vrchat.cloud', {}, err => err ? rej(err) : res())
          );
        }
      }

      console.log('[VRChat] 2FA TOTP validé.');
    }

    // Étape 3 : test final de session
    const check = await axiosInstance.get('/auth/user');
    console.log(`[VRChat] Connecté en tant que ${check.data.displayName}`);
    return axiosInstance;

  } catch (err) {
    console.error('[VRChat] Échec de la connexion :', err.response?.data || err.message);
    process.exit(1);
  }
}

async function loadLogSince() {
  try {
    if (fs.existsSync(LOG_SINCE_FILE)) {
      const content = fs.readFileSync(LOG_SINCE_FILE, 'utf-8').trim();
      _logSince = new Date(content);
      console.log(`[logSince] Chargé: ${_logSince.toISOString()}`);
    }
  } catch (err) {
    console.error('Erreur chargement _logSince:', err);
  }
}

function saveLogSince() {
  if (!_logSince) return;
  try {
    fs.writeFileSync(LOG_SINCE_FILE, _logSince.toISOString(), 'utf-8');
    console.log(`[logSince] Sauvegardé: ${_logSince.toISOString()}`);
  } catch (err) {
    console.error('Erreur sauvegarde _logSince:', err);
  }
}

function createCopyButton(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Copy UserID')
      .setStyle(ButtonStyle.Primary)
      .setCustomId('copy_userid')
  );
}

async function fetchAuditLogs() {
  if (!_logSince) await loadLogSince();

  try {
    const resp = await axiosInstance.get(`/groups/${GROUP_ID}/auditLogs`);
    const entries = resp.data.results;


    const newEntries = entries
      .map(entry => ({
        ...entry,
        created: new Date(entry.created_at)
      }))
      .filter(entry => !_logSince || entry.created > _logSince)
      .sort((a, b) => a.created - b.created);

    if (newEntries.length === 0) return;

    for (const entry of newEntries) {
      const { created, eventType } = entry;
      console.log(entry);
      const event = eventType?.toLowerCase() || 'unknown';
      const key = event.split('.').pop();
      let channelId = null;

      if (ACTION_CHANNEL_MAP[key]) channelId = ACTION_CHANNEL_MAP[key];
      else if (event.includes("instance.kick")) channelId = ACTION_CHANNEL_MAP.kick;
      else if (event.includes("instance.create")) channelId = CHANNEL_INSTANCE_OPEN;
      else if (/(instance\.delete|destroy|close)/.test(event)) channelId = CHANNEL_INSTANCE_CLOSE;
      else if (event.includes("invite.create")) channelId = CHANNEL_INVITE;
      else if (/member\.join|added/.test(event)) channelId = CHANNEL_JOIN;
      else continue;

      const embed = new EmbedBuilder()
        .setTitle(`Group ${event.replace(/_/g, ' ').toUpperCase()}`)
        .addFields(
          { name: 'Action', value: event, inline: true },
          { name: 'User ID', value: `\`${entry.targetId || entry.targetId || 'N/A'}\``, inline: true },
          { name: 'Moderator', value: `\`${entry.actorId || entry.actorId || 'N/A'}\``, inline: true },
          { name: 'Reason', value: entry.description || entry.reason || 'No reason provided', inline: false }
        )
        .setFooter({ text: created.toISOString().replace('T', ' ').split('.')[0] + ' UTC' });

      // Couleur
      if (event.includes("warn")) embed.setColor(Colors.Yellow);
      else if (event.includes("invite")) embed.setColor(Colors.Green);
      else if (event.includes("close")) embed.setColor(Colors.DarkGrey);
      else if (event.includes("create")) embed.setColor(0x87CEEB);
      else if (event.includes("join")) embed.setColor(Colors.Purple);
      else if (event.includes("ban")) embed.setColor(Colors.Red);
      else if (event.includes("kick")) embed.setColor(Colors.Orange);
      else embed.setColor(Colors.Grey);

      const channel = await client.channels.fetch(channelId);
      if (channel) await channel.send({ embeds: [embed], components: [createCopyButton(entry.target_id)] });

      _logSince = created;
    }

    saveLogSince();
  } catch (e) {
    console.error('[VRChat] Erreur fetch logs:', e);
  }
}


client.once('ready', async () => {
  console.log(`[Discord] Connecté en tant que ${client.user.tag}`);
  await loginVRChat();

  setInterval(fetchAuditLogs, 30 * 1000); // 30 secondes
});


client.login(process.env.DISCORD_TOKEN);