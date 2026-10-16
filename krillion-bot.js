/**
 * Krillion Discord Bot
 * npm install
 * Env vars: DISCORD_TOKEN, ANNOUNCE_CHANNEL_ID, DATABASE_URL (Railway provides this automatically)
 * Optional env var: GUILD_ID (registers slash commands to one server immediately instead of globally)
 */

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');
const cron = require('node-cron');
const { Pool } = require('pg');
const {
  EPOCH_DATE,
  TIMEZONE,
  buildRecap,
  parsePost,
  puzzleForDate,
  tallyMedals,
  todayEST
} = require('./krillion');

const TOKEN               = process.env.DISCORD_TOKEN;
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID;
const DATABASE_URL        = process.env.DATABASE_URL;
const GUILD_ID            = process.env.GUILD_ID;
const BACKFILL_MAX_PAGES  = 50;

if (!TOKEN)               throw new Error('Missing DISCORD_TOKEN');
if (!ANNOUNCE_CHANNEL_ID) throw new Error('Missing ANNOUNCE_CHANNEL_ID');
if (!DATABASE_URL)        throw new Error('Missing DATABASE_URL');

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── DB setup ──────────────────────────────────────────────────────────────

async function setupDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS krillion_scores (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      username    TEXT NOT NULL,
      score       INTEGER NOT NULL,
      tiles       TEXT,
      puzzle_num  INTEGER NOT NULL,
      date_str    TEXT NOT NULL,
      channel_id  TEXT,
      message_id  TEXT,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, puzzle_num)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS krillion_state (
      id                 INTEGER PRIMARY KEY DEFAULT 1,
      last_recap_puzzle  INTEGER
    )
  `);
  await pool.query('INSERT INTO krillion_state (id) VALUES (1) ON CONFLICT DO NOTHING');
  console.log('DB ready');
}

async function saveScore(message, parsed) {
  const result = await pool.query(
    `INSERT INTO krillion_scores (user_id, username, score, tiles, puzzle_num, date_str, channel_id, message_id, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, puzzle_num) DO NOTHING
     RETURNING id`,
    [message.author.id, message.author.username, parsed.score, parsed.tiles, parsed.puzzleNum,
      parsed.dateStr, message.channel.id, message.id, message.createdAt]
  );
  return Boolean(result.rows[0]);
}

// ── Recap ─────────────────────────────────────────────────────────────────

async function buildRecapEmbed(puzzleNum) {
  const { rows: dayRows }    = await pool.query('SELECT * FROM krillion_scores WHERE puzzle_num = $1', [puzzleNum]);
  const { rows: allTimeTop } = await pool.query(
    'SELECT * FROM krillion_scores ORDER BY score DESC, recorded_at ASC LIMIT 5'
  );
  const { rows: allRows }    = await pool.query('SELECT user_id, username, score, puzzle_num FROM krillion_scores');

  const recap = buildRecap({ puzzleNum, dayRows, allTimeTop, medalTally: tallyMedals(allRows) });
  return new EmbedBuilder()
    .setTitle(recap.title)
    .setColor(0xFF7F50)
    .addFields(recap.fields)
    .setFooter({ text: recap.footer });
}

// ── Discord client ────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands().catch(err => console.error('Failed to register commands:', err));
  backfillAnnounceChannel().catch(err => console.error('Failed to backfill:', err));
});

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('krillion')
      .setDescription("Show today's Krillion standings")
  ].map(command => command.toJSON());

  if (GUILD_ID) {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.commands.set(commands);
    console.log(`Registered commands for guild ${GUILD_ID}`);
    return;
  }

  await client.application.commands.set(commands);
  console.log('Registered global commands');
}

// Picks up scores posted in the announce channel before the bot existed or while it was down.
async function backfillAnnounceChannel() {
  const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID);
  if (!channel?.isTextBased()) return;

  const epochMs = new Date(`${EPOCH_DATE}T00:00:00-04:00`).getTime();
  const found = [];
  let before;
  for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    for (const msg of batch.values()) {
      if (msg.author.bot) continue;
      const parsed = parsePost(msg.content);
      if (parsed) found.push({ msg, parsed });
    }
    const oldest = batch.last();
    if (oldest.createdTimestamp < epochMs) break;
    before = oldest.id;
  }

  found.sort((a, b) => a.msg.createdTimestamp - b.msg.createdTimestamp);
  let added = 0;
  for (const { msg, parsed } of found) {
    if (await saveScore(msg, parsed)) added++;
  }
  console.log(`Backfill: found ${found.length} Krillion posts, added ${added} new scores`);
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const parsed = parsePost(message.content);
  if (!parsed) return;

  try {
    if (!(await saveScore(message, parsed))) {
      message.react('❌').catch(() => {});
      return;
    }
    message.react('✅').catch(() => {});
    console.log(`Saved: ${message.author.username} -> ${parsed.score} on #${parsed.puzzleNum}`);
  } catch (err) {
    console.error('Error saving score:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'krillion') {
    await interaction.deferReply();
    await interaction.editReply({ embeds: [await buildRecapEmbed(puzzleForDate(todayEST()))] });
  }
});

cron.schedule('0 0 * * *', async () => {
  try {
    const puzzleNum = puzzleForDate(todayEST()) - 1;
    const { rows: stateRows } = await pool.query('SELECT last_recap_puzzle FROM krillion_state WHERE id = 1');
    if (stateRows[0]?.last_recap_puzzle === puzzleNum) {
      console.log(`Recap already sent for #${puzzleNum}, skipping`);
      return;
    }
    const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID);
    if (!channel?.isTextBased()) return;
    await channel.send({ embeds: [await buildRecapEmbed(puzzleNum)] });
    await pool.query('UPDATE krillion_state SET last_recap_puzzle = $1 WHERE id = 1', [puzzleNum]);
    console.log(`Daily recap sent for #${puzzleNum}`);
  } catch (err) {
    console.error('Failed to send recap:', err);
  }
}, { timezone: TIMEZONE });

setupDB().then(() => client.login(TOKEN));
