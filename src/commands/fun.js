const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");

const CATEGORY = "fun";
const BLURPLE = 0x5865f2;

// ─── Small helpers ───────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Fetch JSON with a hard timeout so a slow/dead API never hangs a command.
async function fetchJson(url, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json", "User-Agent": "ggboi-bot" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const funEmbed = (desc, color = BLURPLE) => new EmbedBuilder().setColor(color).setDescription(desc);
const apiErrorEmbed = (what) => new EmbedBuilder().setColor(0xed4245).setDescription(`❌ Couldn't fetch ${what} right now — try again in a bit.`);

// ─── 8ball ───────────────────────────────────────────────────
const EIGHTBALL = [
  "It is certain.", "Without a doubt.", "Yes — definitely.", "You may rely on it.",
  "As I see it, yes.", "Most likely.", "Outlook good.", "Signs point to yes.",
  "Reply hazy, try again.", "Ask again later.", "Better not tell you now.",
  "Cannot predict now.", "Don't count on it.", "My reply is no.",
  "My sources say no.", "Outlook not so good.", "Very doubtful.",
];
function eightball(question) {
  if (!question) return funEmbed("🎱 Ask me a question first.", 0xed4245);
  return funEmbed(`🎱 **Question:** ${question}\n**Answer:** ${pick(EIGHTBALL)}`);
}

// ─── Coinflip ────────────────────────────────────────────────
function coinflip() {
  const side = Math.random() < 0.5 ? "Heads" : "Tails";
  return funEmbed(`🪙 **${side}!**`, 0xfee75c);
}

// ─── Dice ────────────────────────────────────────────────────
// Accepts "NdM" (e.g. 2d6) or a plain max (e.g. 20). Defaults to 1d6.
function roll(spec) {
  let count = 1, sides = 6;
  if (spec) {
    const m = String(spec).toLowerCase().match(/^(\d+)?d(\d+)$/);
    if (m) { count = parseInt(m[1] || "1", 10); sides = parseInt(m[2], 10); }
    else if (/^\d+$/.test(spec)) { sides = parseInt(spec, 10); }
    else return funEmbed("🎲 Usage: `roll`, `roll 20`, or `roll 2d6`.", 0xed4245);
  }
  if (count < 1 || count > 25 || sides < 2 || sides > 1000)
    return funEmbed("🎲 Keep it sane: 1–25 dice, 2–1000 sides.", 0xed4245);
  const rolls = Array.from({ length: count }, () => randInt(1, sides));
  const total = rolls.reduce((a, b) => a + b, 0);
  const detail = count > 1 ? `\n\`[${rolls.join(", ")}]\` = **${total}**` : "";
  return funEmbed(`🎲 Rolling **${count}d${sides}**${detail}${count === 1 ? ` → **${total}**` : ""}`);
}

// ─── Rock Paper Scissors ─────────────────────────────────────
function rps(choice) {
  const opts = { rock: "🪨", paper: "📄", scissors: "✂️" };
  const c = String(choice || "").toLowerCase();
  if (!opts[c]) return funEmbed("Choose `rock`, `paper`, or `scissors`.", 0xed4245);
  const botPick = pick(Object.keys(opts));
  let result;
  if (c === botPick) result = "It's a tie! 🤝";
  else if ((c === "rock" && botPick === "scissors") || (c === "paper" && botPick === "rock") || (c === "scissors" && botPick === "paper"))
    result = "You win! 🎉";
  else result = "I win! 😎";
  return funEmbed(`${opts[c]} vs ${opts[botPick]}\n**${result}**`);
}

// ─── Choose ──────────────────────────────────────────────────
function choose(raw) {
  const options = raw.split(/\s*[|,]\s*/).map(s => s.trim()).filter(Boolean);
  if (options.length < 2) return funEmbed("Give me at least two options separated by `|` or `,`.", 0xed4245);
  return funEmbed(`🤔 I choose: **${pick(options)}**`);
}

// ─── Text toys ───────────────────────────────────────────────
function reverse(text) {
  if (!text) return funEmbed("Give me some text to reverse.", 0xed4245);
  return funEmbed("🔁 " + [...text].reverse().join(""));
}
function mock(text) {
  if (!text) return funEmbed("Give me some text to mock.", 0xed4245);
  const out = [...text].map((ch, i) => (i % 2 ? ch.toUpperCase() : ch.toLowerCase())).join("");
  return funEmbed("🧽 " + out);
}

// ─── Gag stat commands ───────────────────────────────────────
function pp() {
  const len = randInt(0, 15);
  return funEmbed(`📏 Size:\n8${"=".repeat(len)}D`);
}
function iq(targetMention) {
  return funEmbed(`🧠 ${targetMention} has an IQ of **${randInt(1, 200)}**.`);
}
function howGay(targetMention) {
  return funEmbed(`🏳️‍🌈 ${targetMention} is **${randInt(0, 100)}%** gay.`);
}
function ship(a, b) {
  const score = randInt(0, 100);
  const hearts = "💖".repeat(Math.round(score / 20)) || "💔";
  return funEmbed(`💘 **${a}** + **${b}**\nCompatibility: **${score}%** ${hearts}`, 0xeb459e);
}

// ─── Networked fun (free, keyless APIs) ──────────────────────
async function meme() {
  const j = await fetchJson("https://meme-api.com/gimme");
  if (!j?.url) throw new Error("no meme");
  return new EmbedBuilder().setColor(BLURPLE).setTitle(j.title || "Meme").setURL(j.postLink || null).setImage(j.url).setFooter({ text: `👍 ${j.ups ?? 0} • r/${j.subreddit || "memes"}` });
}
async function joke() {
  const j = await fetchJson("https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,racist,sexist,explicit&type=single");
  const text = j?.joke || (j?.setup ? `${j.setup}\n\n||${j.delivery}||` : null);
  if (!text) throw new Error("no joke");
  return funEmbed("😄 " + text);
}
async function dadjoke() {
  const j = await fetchJson("https://icanhazdadjoke.com/");
  if (!j?.joke) throw new Error("no joke");
  return funEmbed("👨 " + j.joke);
}
async function cat() {
  // cataas returns an id we turn into a direct image URL
  const j = await fetchJson("https://cataas.com/cat?json=true");
  const id = j?._id || j?.id;
  if (!id) throw new Error("no cat");
  return new EmbedBuilder().setColor(BLURPLE).setTitle("🐱 Meow").setImage(`https://cataas.com/cat/${id}`);
}
async function dog() {
  const j = await fetchJson("https://dog.ceo/api/breeds/image/random");
  if (j?.status !== "success" || !j?.message) throw new Error("no dog");
  return new EmbedBuilder().setColor(BLURPLE).setTitle("🐶 Woof").setImage(j.message);
}

// ─── Resolve a display name for gag commands (prefix) ────────
function firstMentionOrSelf(message) {
  const u = message.mentions.users.first();
  return u ? `<@${u.id}>` : `<@${message.author.id}>`;
}

// ─── Command defs ────────────────────────────────────────────
module.exports = [
  {
    name: "8ball", description: "Ask the magic 8-ball", category: CATEGORY,
    prefix: (m, a) => m.reply({ embeds: [eightball(a.join(" "))] }),
    slash: new SlashCommandBuilder().setName("8ball").setDescription("Ask the magic 8-ball")
      .addStringOption(o => o.setName("question").setDescription("Your question").setRequired(true)),
    execute: (i) => i.reply({ embeds: [eightball(i.options.getString("question"))] }),
  },
  {
    name: "coinflip", description: "Flip a coin", category: CATEGORY,
    prefix: (m) => m.reply({ embeds: [coinflip()] }),
    slash: new SlashCommandBuilder().setName("coinflip").setDescription("Flip a coin"),
    execute: (i) => i.reply({ embeds: [coinflip()] }),
  },
  {
    name: "roll", description: "Roll dice (e.g. 2d6 or 20)", category: CATEGORY,
    prefix: (m, a) => m.reply({ embeds: [roll(a[0])] }),
    slash: new SlashCommandBuilder().setName("roll").setDescription("Roll dice (e.g. 2d6 or 20)")
      .addStringOption(o => o.setName("dice").setDescription("NdM or a max number").setRequired(false)),
    execute: (i) => i.reply({ embeds: [roll(i.options.getString("dice"))] }),
  },
  {
    name: "rps", description: "Rock paper scissors", category: CATEGORY,
    prefix: (m, a) => m.reply({ embeds: [rps(a[0])] }),
    slash: new SlashCommandBuilder().setName("rps").setDescription("Rock paper scissors")
      .addStringOption(o => o.setName("choice").setDescription("rock, paper or scissors").setRequired(true)
        .addChoices({ name: "rock", value: "rock" }, { name: "paper", value: "paper" }, { name: "scissors", value: "scissors" })),
    execute: (i) => i.reply({ embeds: [rps(i.options.getString("choice"))] }),
  },
  {
    name: "choose", description: "Pick between options (a | b | c)", category: CATEGORY,
    prefix: (m, a) => m.reply({ embeds: [choose(a.join(" "))] }),
    slash: new SlashCommandBuilder().setName("choose").setDescription("Pick between options")
      .addStringOption(o => o.setName("options").setDescription("Options separated by | or ,").setRequired(true)),
    execute: (i) => i.reply({ embeds: [choose(i.options.getString("options"))] }),
  },
  {
    name: "reverse", description: "Reverse some text", category: CATEGORY,
    prefix: (m, a) => m.reply({ embeds: [reverse(a.join(" "))] }),
    slash: new SlashCommandBuilder().setName("reverse").setDescription("Reverse some text")
      .addStringOption(o => o.setName("text").setDescription("Text").setRequired(true)),
    execute: (i) => i.reply({ embeds: [reverse(i.options.getString("text"))] }),
  },
  {
    name: "mock", description: "mOcK sOmE tExT", category: CATEGORY,
    prefix: (m, a) => m.reply({ embeds: [mock(a.join(" "))] }),
    slash: new SlashCommandBuilder().setName("mock").setDescription("mOcK sOmE tExT")
      .addStringOption(o => o.setName("text").setDescription("Text").setRequired(true)),
    execute: (i) => i.reply({ embeds: [mock(i.options.getString("text"))] }),
  },
  {
    name: "ship", description: "Ship two people", category: CATEGORY,
    prefix: (m) => {
      const u = [...m.mentions.users.values()];
      const a = u[0] ? `<@${u[0].id}>` : m.author.username;
      const b = u[1] ? `<@${u[1].id}>` : `<@${m.author.id}>`;
      return m.reply({ embeds: [ship(a, b)], allowedMentions: { parse: [] } });
    },
    slash: new SlashCommandBuilder().setName("ship").setDescription("Ship two people")
      .addUserOption(o => o.setName("first").setDescription("First person").setRequired(true))
      .addUserOption(o => o.setName("second").setDescription("Second person").setRequired(false)),
    execute: (i) => {
      const a = i.options.getUser("first");
      const b = i.options.getUser("second") || i.user;
      return i.reply({ embeds: [ship(`<@${a.id}>`, `<@${b.id}>`)], allowedMentions: { parse: [] } });
    },
  },
  {
    name: "pp", description: "Reveal pp size", category: CATEGORY,
    prefix: (m) => m.reply({ embeds: [pp()] }),
    slash: new SlashCommandBuilder().setName("pp").setDescription("Reveal pp size"),
    execute: (i) => i.reply({ embeds: [pp()] }),
  },
  {
    name: "iq", description: "Measure someone's IQ", category: CATEGORY,
    prefix: (m) => m.reply({ embeds: [iq(firstMentionOrSelf(m))], allowedMentions: { parse: [] } }),
    slash: new SlashCommandBuilder().setName("iq").setDescription("Measure someone's IQ")
      .addUserOption(o => o.setName("user").setDescription("Target").setRequired(false)),
    execute: (i) => { const u = i.options.getUser("user") || i.user; return i.reply({ embeds: [iq(`<@${u.id}>`)], allowedMentions: { parse: [] } }); },
  },
  {
    name: "howgay", description: "Gay rate someone", category: CATEGORY,
    prefix: (m) => m.reply({ embeds: [howGay(firstMentionOrSelf(m))], allowedMentions: { parse: [] } }),
    slash: new SlashCommandBuilder().setName("howgay").setDescription("Gay rate someone")
      .addUserOption(o => o.setName("user").setDescription("Target").setRequired(false)),
    execute: (i) => { const u = i.options.getUser("user") || i.user; return i.reply({ embeds: [howGay(`<@${u.id}>`)], allowedMentions: { parse: [] } }); },
  },
  {
    name: "meme", description: "Random meme", category: CATEGORY,
    prefix: async (m) => { try { m.reply({ embeds: [await meme()], allowedMentions: { parse: [] } }); } catch { m.reply({ embeds: [apiErrorEmbed("a meme")] }); } },
    slash: new SlashCommandBuilder().setName("meme").setDescription("Random meme"),
    execute: async (i) => { await i.deferReply(); try { i.editReply({ embeds: [await meme()], allowedMentions: { parse: [] } }); } catch { i.editReply({ embeds: [apiErrorEmbed("a meme")] }); } },
  },
  {
    name: "joke", description: "Random joke", category: CATEGORY,
    prefix: async (m) => { try { m.reply({ embeds: [await joke()], allowedMentions: { parse: [] } }); } catch { m.reply({ embeds: [apiErrorEmbed("a joke")] }); } },
    slash: new SlashCommandBuilder().setName("joke").setDescription("Random joke"),
    execute: async (i) => { await i.deferReply(); try { i.editReply({ embeds: [await joke()], allowedMentions: { parse: [] } }); } catch { i.editReply({ embeds: [apiErrorEmbed("a joke")] }); } },
  },
  {
    name: "dadjoke", description: "Random dad joke", category: CATEGORY,
    prefix: async (m) => { try { m.reply({ embeds: [await dadjoke()], allowedMentions: { parse: [] } }); } catch { m.reply({ embeds: [apiErrorEmbed("a dad joke")] }); } },
    slash: new SlashCommandBuilder().setName("dadjoke").setDescription("Random dad joke"),
    execute: async (i) => { await i.deferReply(); try { i.editReply({ embeds: [await dadjoke()], allowedMentions: { parse: [] } }); } catch { i.editReply({ embeds: [apiErrorEmbed("a dad joke")] }); } },
  },
  {
    name: "cat", description: "Random cat picture", category: CATEGORY,
    prefix: async (m) => { try { m.reply({ embeds: [await cat()], allowedMentions: { parse: [] } }); } catch { m.reply({ embeds: [apiErrorEmbed("a cat")] }); } },
    slash: new SlashCommandBuilder().setName("cat").setDescription("Random cat picture"),
    execute: async (i) => { await i.deferReply(); try { i.editReply({ embeds: [await cat()], allowedMentions: { parse: [] } }); } catch { i.editReply({ embeds: [apiErrorEmbed("a cat")] }); } },
  },
  {
    name: "dog", description: "Random dog picture", category: CATEGORY,
    prefix: async (m) => { try { m.reply({ embeds: [await dog()], allowedMentions: { parse: [] } }); } catch { m.reply({ embeds: [apiErrorEmbed("a dog")] }); } },
    slash: new SlashCommandBuilder().setName("dog").setDescription("Random dog picture"),
    execute: async (i) => { await i.deferReply(); try { i.editReply({ embeds: [await dog()], allowedMentions: { parse: [] } }); } catch { i.editReply({ embeds: [apiErrorEmbed("a dog")] }); } },
  },
  {
    name: "femboyify", description: "Toggle a user's femboyified nickname", category: CATEGORY,
    prefix: async (m, a) => {
      const target = m.mentions.members.first();
      if (!target) return m.reply({ embeds: [funEmbed("❌ Usage: `femboyify @user on/off`.", 0xed4245)] });
      const mode = (a[1] || "").toLowerCase();
      if (mode !== "on" && mode !== "off")
        return m.reply({ embeds: [funEmbed("❌ Specify `on` or `off`. Usage: `femboyify @user on` or `femboyify @user off`.", 0xed4245)] });

      const botMember = m.guild.members.me;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames))
        return m.reply({ embeds: [funEmbed("❌ I need **Manage Nicknames** permission.", 0xed4245)] });
      if (!target.manageable)
        return m.reply({ embeds: [funEmbed("❌ Can't change their nickname — their role is above mine.", 0xed4245)] });

      if (mode === "on") {
        const original = target.nickname || target.user.username;
        const newNick = `the cute ${original.replace(/^the cute | femboy$/gi, "").trim()} femboy`;
        try {
          await target.setNickname(newNick, "Femboyified");
          await require("../femboyify").setFemboyified(m.guild.id, target.id, original);
          m.reply({ embeds: [funEmbed(`✨ ${target} → **${newNick}**`)], allowedMentions: { parse: [] } });
        } catch (err) {
          m.reply({ embeds: [funEmbed(`❌ Failed: ${err.message}`, 0xed4245)] });
        }
      } else {
        const femboyify = require("../femboyify");
        const original = femboyify.getOriginalNick(m.guild.id, target.id);
        if (!original) return m.reply({ embeds: [funEmbed("❌ That user isn't femboyified.", 0xed4245)] });
        try {
          await target.setNickname(original, "Unfemboyified");
          await femboyify.removeFemboyified(m.guild.id, target.id);
          m.reply({ embeds: [funEmbed(`✨ ${target} restored to **${original}**`)], allowedMentions: { parse: [] } });
        } catch (err) {
          m.reply({ embeds: [funEmbed(`❌ Failed to restore: ${err.message}`, 0xed4245)] });
        }
      }
    },
    slash: new SlashCommandBuilder().setName("femboyify").setDescription("Toggle a user's femboyified nickname")
      .addUserOption(o => o.setName("user").setDescription("The user").setRequired(true))
      .addStringOption(o => o.setName("mode").setDescription("on or off").setRequired(true)
        .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })),
    execute: async (i) => {
      const target = i.options.getMember("user");
      if (!target) return i.reply({ embeds: [funEmbed("❌ User not found.", 0xed4245)], flags: MessageFlags.Ephemeral });
      const mode = i.options.getString("mode");

      const botMember = i.guild.members.me;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames))
        return i.reply({ embeds: [funEmbed("❌ I need **Manage Nicknames** permission.", 0xed4245)], flags: MessageFlags.Ephemeral });
      if (!target.manageable)
        return i.reply({ embeds: [funEmbed("❌ Can't change their nickname — their role is above mine.", 0xed4245)], flags: MessageFlags.Ephemeral });

      if (mode === "on") {
        const original = target.nickname || target.user.username;
        const newNick = `the cute ${original.replace(/^the cute | femboy$/gi, "").trim()} femboy`;
        try {
          await target.setNickname(newNick, "Femboyified");
          await require("../femboyify").setFemboyified(i.guild.id, target.id, original);
          i.reply({ embeds: [funEmbed(`✨ ${target} → **${newNick}**`)], allowedMentions: { parse: [] } });
        } catch (err) {
          i.reply({ embeds: [funEmbed(`❌ Failed: ${err.message}`, 0xed4245)], flags: MessageFlags.Ephemeral });
        }
      } else {
        const femboyify = require("../femboyify");
        const original = femboyify.getOriginalNick(i.guild.id, target.id);
        if (!original) return i.reply({ embeds: [funEmbed("❌ That user isn't femboyified.", 0xed4245)], flags: MessageFlags.Ephemeral });
        try {
          await target.setNickname(original, "Unfemboyified");
          await femboyify.removeFemboyified(i.guild.id, target.id);
          i.reply({ embeds: [funEmbed(`✨ ${target} restored to **${original}**`)], allowedMentions: { parse: [] } });
        } catch (err) {
          i.reply({ embeds: [funEmbed(`❌ Failed to restore: ${err.message}`, 0xed4245)], flags: MessageFlags.Ephemeral });
        }
      }
    },
  },
];
