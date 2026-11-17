import { isRoleAllowed } from '../../../features/auth/authorization/roleAccess.js'

// A section is worth a heading only if something inside it can be opened.
export function hasAvailableItem(section, availablePaths) {
  return section.items.some((item) => item.path && availablePaths.has(item.path))
}

// The sections a role sees: its own pages, and no heading left over for a
// section whose pages it cannot open. Sections that are only "coming soon"
// placeholders for everyone keep showing, as they always did.
export function sectionsForRole(sections, role, { accessByPath, availablePaths }) {
  return sections.flatMap((section) => {
    const items = section.items.filter((item) => isRoleAllowed(role, accessByPath.get(item.path)))
    const lostEveryPage = hasAvailableItem(section, availablePaths)
      && !hasAvailableItem({ items }, availablePaths)

    return lostEveryPage ? [] : [{ ...section, items }]
  })
}
