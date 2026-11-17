import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth.js'
import { startPageOf } from '../authorization/roleAccess.js'

// Home is for everyone except the roles that start on a page of their own.
export default function StartPageGate({ children }) {
  const { profile } = useAuth()
  const startPage = startPageOf(profile?.role)

  return startPage === '/' ? children : <Navigate to={startPage} replace />
}
