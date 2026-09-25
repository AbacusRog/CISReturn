import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Contractors from './pages/Contractors'
import ContractorDetail from './pages/ContractorDetail'
import MonthlyReturns from './pages/MonthlyReturns'
import MonthlyReturnDetail from './pages/MonthlyReturnDetail'

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="p-8 text-slate-400 text-sm">Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Contractors />} />
            <Route path="/contractors/:contractorId" element={<ContractorDetail />} />
            <Route path="/returns" element={<MonthlyReturns />} />
            <Route path="/returns/:returnId" element={<MonthlyReturnDetail />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
