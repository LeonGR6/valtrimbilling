/**
 * The function that creates one Package of a division, whichever kind its input says: an Options
 * Package (`kind: 'OPTIONS'`) or a Draw Package.
 */
export function packageCreator({ createDraw, createOptions }) {
  return (input) => (input.kind === 'OPTIONS' ? createOptions(input) : createDraw(input))
}

/**
 * Creates the Packages a divided selection becomes, one after the other, with `createPackage(input)`.
 * If one fails after the first, the ones already made stay and `error` says what stopped the rest;
 * if the first fails nothing was made and the error is thrown, so the dialog can show it.
 *
 * @returns {Promise<{ created: object[], error: Error | null }>}
 */
export async function createPackagesInOrder(createPackage, inputs) {
  const created = []

  for (const input of inputs) {
    try {
      created.push(await createPackage(input))
    } catch (error) {
      if (created.length === 0) throw error
      return { created, error }
    }
  }

  return { created, error: null }
}

/** The notice that says which Packages were created and, when it stopped, what is left to do. */
export function describeCreatedPackages({ created, error }) {
  const numbers = created.map((record) => record.packageNumber).join(', ')

  if (error) {
    return {
      severity: 'error',
      message: `${numbers} ${created.length === 1 ? 'was' : 'were'} created, but the next Package could not be: ${error.message} Open Create Package again to bill what is left.`,
    }
  }

  return { severity: 'success', message: `Created ${numbers}.` }
}
