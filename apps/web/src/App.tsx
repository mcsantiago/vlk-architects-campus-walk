import { Navigate, Route, Routes } from 'react-router';
import { useCurrentUser } from './user';
import { AssetEditPage } from './pages/AssetEditPage';
import { AssetNewPage } from './pages/AssetNewPage';
import { AssetPage } from './pages/AssetPage';
import { BuildingPage } from './pages/BuildingPage';
import { CampusPage } from './pages/CampusPage';
import { PhotoPage } from './pages/PhotoPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { RoomPage } from './pages/RoomPage';
import { SummaryPage } from './pages/SummaryPage';
import { SystemsPage } from './pages/SystemsPage';
import { WhoPage } from './pages/WhoPage';

/**
 * Walker's flow: who's walking → projects → campus → building (floor filter) → room → asset / photo.
 * Every route sits under the campus so each screen can link back up the tree without a second
 * lookup. The name screen stands in for login until real authentication lands (see README).
 */
export function App() {
  const user = useCurrentUser();
  if (!user) return <WhoPage />;
  return (
    <Routes>
      <Route path="/" element={<ProjectsPage />} />
      <Route path="/c/:campusId" element={<CampusPage />} />
      <Route path="/c/:campusId/summary" element={<SummaryPage />} />
      <Route path="/c/:campusId/buildings/:buildingId" element={<BuildingPage />} />
      <Route path="/c/:campusId/buildings/:buildingId/systems" element={<SystemsPage />} />
      <Route path="/c/:campusId/rooms/:roomId" element={<RoomPage />} />
      <Route path="/c/:campusId/photos/:photoId" element={<PhotoPage />} />
      <Route path="/c/:campusId/assets/new" element={<AssetNewPage />} />
      <Route path="/c/:campusId/assets/:assetId" element={<AssetPage />} />
      <Route path="/c/:campusId/assets/:assetId/edit" element={<AssetEditPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
