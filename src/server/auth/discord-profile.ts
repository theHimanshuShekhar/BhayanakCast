export interface DiscordProfile {
  id: string
  username: string
  global_name?: string | null
  avatar?: string | null
  image_url?: string | null
  email?: string | null
  verified?: boolean
  discriminator?: string
}

export interface MappedDiscordProfile {
  id: string
  name: string
  image: string
  email: string
  emailVerified: boolean
}

const DISCORD_ID = /^\d{17,20}$/

export function discordPlaceholderEmail(discordId: string) {
  if (!DISCORD_ID.test(discordId)) throw new TypeError('Invalid Discord id')
  return `${discordId}@discord.placeholder.local`
}

export function mapDiscordProfile(profile: DiscordProfile): MappedDiscordProfile {
  const email = profile.email?.trim() || discordPlaceholderEmail(profile.id)
  const image = profile.image_url || discordAvatarUrl(profile)

  return {
    id: profile.id,
    name: profile.global_name?.trim() || profile.username,
    image,
    email,
    emailVerified: Boolean(profile.email?.trim() && profile.verified),
  }
}

function discordAvatarUrl(profile: DiscordProfile) {
  if (profile.avatar) {
    const format = profile.avatar.startsWith('a_') ? 'gif' : 'png'
    return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${format}`
  }

  const index =
    profile.discriminator && profile.discriminator !== '0'
      ? Number.parseInt(profile.discriminator, 10) % 5
      : Number(BigInt(profile.id) >> 22n) % 6
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}
