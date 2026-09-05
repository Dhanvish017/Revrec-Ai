import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import './AppLayout.css'

export default function AppLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="content-area">
        <Topbar />
        <main className="scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
