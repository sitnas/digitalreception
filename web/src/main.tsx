import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';

// Kiosk and console are split: the tablet never downloads the admin code.
const KioskApp = lazy(() => import('./kiosk/KioskApp').then((m) => ({ default: m.KioskApp })));
const BadgeApp = lazy(() => import('./access/BadgeApp').then((m) => ({ default: m.BadgeApp })));
const ReaderApp = lazy(() => import('./access/ReaderApp').then((m) => ({ default: m.ReaderApp })));
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/kiosk/*" element={<KioskApp />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="/badge/*" element={<BadgeApp />} />
          <Route path="/reader/*" element={<ReaderApp />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>,
);
