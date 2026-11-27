import { createContext, useContext } from 'react'

// What the sections of the setup form know about the problems of the form: whether to show them yet
// (after the person tries to save, and from then on while they fix them) and how many each part has.
export const FormIssuesContext = createContext({ showErrors: false, counts: {} })

export function useFormIssues() {
  return useContext(FormIssuesContext)
}
