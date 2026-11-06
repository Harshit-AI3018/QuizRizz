import React from 'react';
import { Outlet } from 'react-router-dom';
import { NavigationShell } from './NavigationShell';
import { Footer } from './Footer';
import { useAuth } from '../../context/AuthContext';

export const RootLayout: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      {isAuthenticated && <NavigationShell />}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
};
