const db = require("./db");
const { PermissionFlagsBits, ChannelType } = require("discord.js");

// ─── Serialize a guild into a restorable JSON snapshot ────────────────────

function serializeGuild(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter(r => !r.managed && r.id !== guild.id && r.name !== "@everyone")
    .sort((a, b) => b.position - a.position)
    .map(r => ({
      name: r.name,
      color: r.hexColor,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: String(r.permissions.bitfield),
      position: r.position,
    }));

  const categories = [...guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).values()]
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .map(cat => {
      const overwrites = [...cat.permissionOverwrites.cache.values()]
      .filter(ow => ow.type === 0) // only role overwrites (member IDs don't map across servers)
      .map(ow => {
        const role = guild.roles.cache.get(ow.id);
        return {
          roleName: role?.name || null,
          type: ow.type,
          allow: String(ow.allow.bitfield),
          deny: String(ow.deny.bitfield),
        };
      })
      .filter(ow => ow.roleName);
      return { name: cat.name, position: cat.rawPosition ?? 0, overwrites };
    });

  const channels = guild.channels.cache
    .filter(c => typeof c.lockPermissions === "function" && c.parentId)
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .map(ch => {
      const overwrites = [...ch.permissionOverwrites.cache.values()]
      .filter(ow => ow.type === 0)
      .map(ow => {
        const role = guild.roles.cache.get(ow.id);
        return {
          roleName: role?.name || null,
          type: ow.type,
          allow: String(ow.allow.bitfield),
          deny: String(ow.deny.bitfield),
        };
      })
      .filter(ow => ow.roleName);
      return {
        name: ch.name,
        type: ch.type,        // 0 = text, 2 = voice, 5 = announcement, 13 = stage, 15 = forum, 16 = media
        parentName: ch.parent?.name || null,
        position: ch.rawPosition ?? 0,
        topic: ch.topic || "",
        nsfw: ch.nsfw || false,
        rateLimitPerUser: ch.rateLimitPerUser || 0,
        bitrate: ch.bitrate || null,
        userLimit: ch.userLimit || null,
        defaultAutoArchiveDuration: ch.defaultAutoArchiveDuration || null,
        overwrites,
      };
    });

  return {
    guildName: guild.name,
    guildId: guild.id,
    roles,
    categories,
    channels,
  };
}

// ─── Restore a guild from a backup snapshot ───────────────────────────────

// Apply permission overwrites for a created channel/category, resolving roles by name.
async function applyOverwrites(target, overwrites, guild) {
  for (const ow of overwrites) {
    const role = guild.roles.cache.find(r => r.name === ow.roleName);
    if (!role) {
      console.warn(`[backup] Overwrite skipped: role "${ow.roleName}" not found`);
      continue;
    }
    await target.permissionOverwrites.create(role.id, {
      Allow: BigInt(ow.allow || "0"),
      Deny: BigInt(ow.deny || "0"),
    }, { reason: "Backup restore" }).catch(() => {});
  }
}

async function restoreGuild(guild, data, options = {}) {
  const { skipRoles = false, skipChannels = false, dryRun = false } = options;
  const log = [];
  const summary = { rolesCreated: 0, rolesSkipped: 0, categoriesCreated: 0, channelsCreated: 0, overwritesApplied: 0, errors: [] };

  // 1. Create roles (bottom-up by position so hierarchy is correct)
  if (!skipRoles && data.roles?.length) {
    const sorted = [...data.roles].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (const r of sorted) {
      try {
        const existing = guild.roles.cache.find(role => role.name === r.name);
        if (existing && !options.force) {
          log.push(`Role "${r.name}" already exists — skipped`);
          summary.rolesSkipped++;
          continue;
        }
        if (!dryRun) {
          await guild.roles.create({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: BigInt(r.permissions || "0"),
            position: r.position,
            reason: "Server backup restore",
          });
        }
        log.push(`Role created: ${r.name}`);
        summary.rolesCreated++;
      } catch (err) {
        log.push(`Role "${r.name}" FAILED: ${err.message}`);
        summary.errors.push({ item: `Role: ${r.name}`, error: err.message });
      }
    }
  }

  // Fetch fresh guild after role creation
  const freshGuild = dryRun ? guild : await guild.client.guilds.fetch(guild.id);

  // 2. Create categories (by position)
  if (!skipChannels) {
    if (data.categories?.length) {
      const sorted = [...data.categories].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      for (const cat of sorted) {
        try {
          const existing = freshGuild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === cat.name);
          if (existing && !options.force) {
            log.push(`Category "${cat.name}" already exists — skipped`);
            continue;
          }
          if (!dryRun) {
            const created = await freshGuild.channels.create({
              name: cat.name,
              type: ChannelType.GuildCategory,
              position: cat.position,
              reason: "Server backup restore",
            });
            if (cat.overwrites?.length) {
              await applyOverwrites(created, cat.overwrites, freshGuild);
              summary.overwritesApplied += cat.overwrites.length;
            }
          }
          log.push(`Category created: ${cat.name}`);
          summary.categoriesCreated++;
        } catch (err) {
          log.push(`Category "${cat.name}" FAILED: ${err.message}`);
          summary.errors.push({ item: `Category: ${cat.name}`, error: err.message });
        }
      }
    }

    // 3. Create channels (by position, with parent category mapping)
    if (data.channels?.length) {
      const sorted = [...data.channels].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      for (const ch of sorted) {
        try {
          // Map parent name → ID (fresh guild)
          let parentId = null;
          if (ch.parentName) {
            const parent = freshGuild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === ch.parentName);
            if (parent) parentId = parent.id;
          }

          if (!dryRun) {
            const created = await freshGuild.channels.create({
              name: ch.name,
              type: ch.type ?? 0,
              parent: parentId,
              position: ch.position ?? 0,
              topic: ch.topic || null,
              nsfw: ch.nsfw || false,
              rateLimitPerUser: ch.rateLimitPerUser || 0,
              bitrate: ch.bitrate || undefined,
              userLimit: ch.userLimit || undefined,
              defaultAutoArchiveDuration: ch.defaultAutoArchiveDuration || undefined,
              reason: "Server backup restore",
            });
            if (ch.overwrites?.length) {
              await applyOverwrites(created, ch.overwrites, freshGuild);
              summary.overwritesApplied += ch.overwrites.length;
            }
          }
          log.push(`Channel created: ${ch.parentName ? `${ch.parentName}/` : ""}#${ch.name}`);
          summary.channelsCreated++;
          // Brief pause to avoid Discord rate limits on bulk restores
          if (!dryRun) await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          log.push(`Channel "${ch.name}" FAILED: ${err.message}`);
          summary.errors.push({ item: `Channel: ${ch.name}`, error: err.message });
        }
      }
    }
  }

  return { log, summary };
}

// ─── Public API ───────────────────────────────────────────────────────────

async function create(guild, name, createdBy) {
  const data = serializeGuild(guild);
  const id = await db.addBackup(guild.id, name.slice(0, 100), data, createdBy);
  return { id, name, roles: data.roles.length, categories: data.categories.length, channels: data.channels.length };
}

async function get(guildId) {
  return db.getBackups(guildId);
}

async function getById(id) {
  const row = await db.getBackup(id);
  if (!row) return null;      let data = {};
      try { data = db.safeJsonParse(row.data, {}); } catch { /* ignore */ }
      return { ...row, data };
}

async function remove(id) {
  await db.deleteBackup(id);
}

module.exports = {
  serializeGuild,
  restoreGuild,
  create,
  get,
  getById,
  remove,
};
