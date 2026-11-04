import React from 'react';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  className = '',
  label = 'Loading...',
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4',
  }[size];

  return (
    <div className={`flex items-center justify-center ${className}`} role="status">
      <div
        className={`${sizeClasses} border-gray-200 border-t-green-600 rounded-full animate-spin`}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
};
