/** "CODE — Name (Inactive)": how a Community is named in the Users screens. */
export function communityLabel(community) {
  const code = community.code ? `${community.code} — ` : ''
  const inactive = community.isActive ? '' : ' (Inactive)'
  return `${code}${community.name}${inactive}`
}
