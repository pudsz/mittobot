// /join and /leave — manually join/leave a voice channel
const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const { isOwner, successEmbed, errorEmbed, noPermEmbed } = require("../utils");

// ─── Prefix: $join [channel-id | channel-mention] ────────────────────────────
async function prefixJoin(message, args, ctx) {
  if (!isOwner(message.author.id))
    return message.reply({ embeds: [noPermEmbed()] });

  if (!message.guild)
    return message.reply({ embeds: [errorEmbed("This command can only be used in a server.")] });

  const vm = ctx.voiceManager;
  if (!vm)
    return message.reply({ embeds: [errorEmbed("Voice system is not initialised.")] });

  // Resolve the target voice channel
  let channel = null;

  if (args.length > 0) {
    // Try mention/ID
    const id = args[0].replace(/[<#>]/g, "");
    channel = message.guild.channels.cache.get(id);
  } else {
    // Default: join the caller's current voice channel
    channel = message.member?.voice?.channel;
  }

  if (!channel) {
    return message.reply({
      embeds: [errorEmbed(
        args.length > 0
          ? "Could not find that channel. Provide a valid voice channel ID or mention."
          : "You're not in a voice channel. Join one first, or specify a channel ID."
      )],
    });
  }

  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    return message.reply({ embeds: [errorEmbed("That's not a voice channel.")] });
  }

  const result = await vm.joinChannel(
    message.guild.id, channel.id, message.author.id, message.guild, channel,
  );

  if (!result.ok) {
    return message.reply({ embeds: [errorEmbed(result.error)] });
  }

  await message.reply({ embeds: [successEmbed(`Joined **${channel.name}** 🔊`)] });
}

// ─── Slash: /join ────────────────────────────────────────────────────────────
async function slashJoin(interaction, ctx) {
  if (!isOwner(interaction.user.id))
    return interaction.reply({ embeds: [noPermEmbed()], flags: MessageFlags.Ephemeral });

  if (!interaction.guild)
    return interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], flags: MessageFlags.Ephemeral });

  const vm = ctx.voiceManager;
  if (!vm)
    return interaction.reply({ embeds: [errorEmbed("Voice system is not initialised.")], flags: MessageFlags.Ephemeral });

  // Resolve channel: explicit option > caller's current VC
  let channel = interaction.options.getChannel("channel");
  if (!channel) {
    channel = interaction.member?.voice?.channel;
  }

  if (!channel) {
    return interaction.reply({
      embeds: [errorEmbed("Specify a voice channel or join one first.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    return interaction.reply({ embeds: [errorEmbed("That's not a voice channel.")], flags: MessageFlags.Ephemeral });
  }

  // Defer — joining can take a moment
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await vm.joinChannel(
    interaction.guild.id, channel.id, interaction.user.id, interaction.guild, channel,
  );

  if (!result.ok) {
    return interaction.editReply({ embeds: [errorEmbed(result.error)] });
  }

  await interaction.editReply({ embeds: [successEmbed(`Joined **${channel.name}** 🔊`)] });
}

// ─── Prefix: $leave [channel-id] ────────────────────────────────────────────
async function prefixLeave(message, args, ctx) {
  if (!isOwner(message.author.id))
    return message.reply({ embeds: [noPermEmbed()] });

  if (!message.guild)
    return message.reply({ embeds: [errorEmbed("This command can only be used in a server.")] });

  const vm = ctx.voiceManager;
  if (!vm)
    return message.reply({ embeds: [errorEmbed("Voice system is not initialised.")] });

  // Resolve the target channel to leave
  let channelId = null;

  if (args.length > 0) {
    channelId = args[0].replace(/[<#>]/g, "");
  } else {
    // Find any session the bot is in for this guild
    const sessions = vm.getActiveSessions().filter(s => s.guildId === message.guild.id);
    if (sessions.length === 1) {
      channelId = sessions[0].channelId;
    } else if (sessions.length > 1) {
      return message.reply({
        embeds: [errorEmbed("I'm in multiple voice channels. Please specify which one to leave.")],
      });
    }
  }

  if (!channelId) {
    return message.reply({ embeds: [errorEmbed("I'm not in any voice channel.")] });
  }

  const channelName = message.guild.channels.cache.get(channelId)?.name || channelId;
  const result = await vm.leaveChannel(message.guild.id, channelId);

  if (!result.ok) {
    return message.reply({ embeds: [errorEmbed(result.error)] });
  }

  await message.reply({ embeds: [successEmbed(`Left **${channelName}** 👋`)] });
}

// ─── Slash: /leave ───────────────────────────────────────────────────────────
async function slashLeave(interaction, ctx) {
  if (!isOwner(interaction.user.id))
    return interaction.reply({ embeds: [noPermEmbed()], flags: MessageFlags.Ephemeral });

  if (!interaction.guild)
    return interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], flags: MessageFlags.Ephemeral });

  const vm = ctx.voiceManager;
  if (!vm)
    return interaction.reply({ embeds: [errorEmbed("Voice system is not initialised.")], flags: MessageFlags.Ephemeral });

  let channel = interaction.options.getChannel("channel");
  let channelId = channel?.id;

  if (!channelId) {
    const sessions = vm.getActiveSessions().filter(s => s.guildId === interaction.guild.id);
    if (sessions.length === 1) {
      channelId = sessions[0].channelId;
    } else if (sessions.length > 1) {
      return interaction.reply({
        embeds: [errorEmbed("I'm in multiple voice channels. Please specify which one to leave.")],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (!channelId) {
    return interaction.reply({ embeds: [errorEmbed("I'm not in any voice channel.")], flags: MessageFlags.Ephemeral });
  }

  const channelName = interaction.guild.channels.cache.get(channelId)?.name || channelId;
  const result = await vm.leaveChannel(interaction.guild.id, channelId);

  if (!result.ok) {
    return interaction.reply({ embeds: [errorEmbed(result.error)], flags: MessageFlags.Ephemeral });
  }

  await interaction.reply({ embeds: [successEmbed(`Left **${channelName}** 👋`)], flags: MessageFlags.Ephemeral });
}

module.exports = [
  {
    name: "join",
    aliases: ["vc", "voicejoin"],
    description: "Join a voice channel (owner only)",
    defaultPermission: "owner",
    prefix: prefixJoin,
  },
  {
    name: "leave",
    aliases: ["vcleave", "voiceleave", "disconnect", "dc"],
    description: "Leave the current voice channel (owner only)",
    defaultPermission: "owner",
    prefix: prefixLeave,
  },
  {
    // Consolidated slash surface: `/voice join|leave` (keeps us under Discord's
    // 100 global-command cap; `$join` / `$leave` prefixes are unchanged above).
    name: "voice",
    description: "Voice channel controls (owner only)",
    defaultPermission: "owner",
    slash: new SlashCommandBuilder()
      .setName("voice")
      .setDescription("Voice channel controls (owner only)")
      .addSubcommand(sub =>
        sub
          .setName("join")
          .setDescription("Join a voice channel (defaults to your current VC)")
          .addChannelOption(opt =>
            opt
              .setName("channel")
              .setDescription("The voice channel to join (defaults to your current VC)")
              .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
              .setRequired(false),
          ),
      )
      .addSubcommand(sub =>
        sub
          .setName("leave")
          .setDescription("Leave a voice channel (auto-detected if only in one)")
          .addChannelOption(opt =>
            opt
              .setName("channel")
              .setDescription("The voice channel to leave (auto-detected if only in one)")
              .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
              .setRequired(false),
          ),
      ),
    execute: async (interaction, ctx) => {
      return interaction.options.getSubcommand() === "join"
        ? slashJoin(interaction, ctx)
        : slashLeave(interaction, ctx);
    },
  },
];
