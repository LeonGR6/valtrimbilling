import { useMemo, useState } from 'react'
import { initialPeople } from '../data/people.js'
import { PeopleContext } from './peopleContext.js'

export function PeopleProvider({ children }) {
  const [people, setPeople] = useState(initialPeople)
  const value = useMemo(() => ({ people, setPeople }), [people])

  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>
}
