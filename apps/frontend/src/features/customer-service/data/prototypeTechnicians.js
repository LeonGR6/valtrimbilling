// Existing simulation personnel, independent of their appointment history.
// IDs are stable identifiers, not calculated from names at runtime.
export const prototypeTechnicians = [
  { id: 'prototype-Hilario Najera', name: 'Hilario Najera' },
  { id: 'prototype-Jorge Murillo', name: 'Jorge Murillo' },
]

// technicianIds is the complete assignment. Singular fields support older records only.
export function assignedPrototypeTechnicianIds(request, technicians = prototypeTechnicians) {
  if (Array.isArray(request.technicianIds)) {
    return [...new Set(request.technicianIds.filter((id) => id != null && String(id).trim()).map(String))]
  }
  if (request.technicianId != null) return [String(request.technicianId)]
  const technician = technicians.find((person) => person.name === request.technicianName)
  return technician ? [String(technician.id)] : []
}
