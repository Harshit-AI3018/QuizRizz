import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-white border-t border-gray-200 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          {/* Brand */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-green-600 flex items-center justify-center text-white font-bold text-sm">
                Q
              </div>
              <span className="text-sm font-bold text-gray-900 tracking-tight">QuizRizz</span>
            </div>
            <p className="text-xs text-gray-500 ml-8">Make every question count.</p>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500">
            <span className="text-gray-400 cursor-default">About</span>
            <div className="flex flex-col gap-0.5">
              <span className="text-gray-500 font-medium">Contact&nbsp;/&nbsp;Support</span>
              <span className="text-gray-500">Pragya Shree</span>
              <a
                href="mailto:pragyashree1667@gmail.com"
                className="text-green-600 hover:text-green-700 hover:underline break-all"
              >
                pragyashree1667@gmail.com
              </a>
            </div>
            <span className="text-gray-400 cursor-default">Privacy&nbsp;Policy</span>
            <span className="text-gray-400 cursor-default">Terms&nbsp;of&nbsp;Service</span>
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-gray-100 text-xs text-gray-400 text-center sm:text-left">
          © 2026 QuizRizz. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

