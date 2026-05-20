import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { MeetPage } from './pages/MeetPage'
import { AthleteProfilePage } from './pages/AthleteProfilePage'
import { SearchPage } from './pages/SearchPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/meet/:id" element={<MeetPage />} />
        <Route path="/athlete/:id" element={<AthleteProfilePage />} />
        <Route path="/search" element={<SearchPage />} />
      </Route>
    </Routes>
  )
}
