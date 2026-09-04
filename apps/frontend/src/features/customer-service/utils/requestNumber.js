// Folios read 'CS-1045' and are never typed by hand: the next one is the
// highest already issued plus one.
//
// This is as far as a client can get on its own. Two coordinators creating a
// request at the same moment are both offered the same number, and the second
// save fails the uniqueness check in the schema. Once the table lives in
// Postgres the number comes from a sequence and the race disappears — until
// then the schema check is the net.
const PREFIX = 'CS-'
const NUMBERED = /^CS-(\d+)$/
const FIRST_NUMBER = 1001

export function nextRequestNumber(requests) {
  const highest = requests.reduce((max, request) => {
    const match = NUMBERED.exec(String(request.requestNumber ?? '').trim().toUpperCase())

    return match ? Math.max(max, Number(match[1])) : max
  }, FIRST_NUMBER - 1)

  return `${PREFIX}${highest + 1}`
}
