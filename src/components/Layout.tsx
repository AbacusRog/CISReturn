import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const navItems = [
  { to: '/', label: 'Contractors' },
  { to: '/returns', label: 'Monthly Returns' },
]

export default function Layout() {
  const { signOut, session } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex items-center gap-4 sm:gap-6">
            <span className="font-semibold text-slate-900 text-sm sm:text-base">CIS Monthly Return</span>
            <nav className="flex gap-3 sm:gap-4">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  className={({ isActive }) =>
                    `text-sm ${isActive ? 'text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 order-last sm:order-none w-full sm:w-auto justify-between sm:justify-end">
            <span className="text-xs text-slate-400 truncate max-w-[60vw] sm:max-w-none">
              {session?.user?.email}
            </span>
            <button onClick={signOut} className="text-sm text-slate-500 hover:text-slate-700 shrink-0">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <Outlet />
      </main>
    </div>
  )
}
