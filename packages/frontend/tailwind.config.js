import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Severity colors
        severity: {
          1: '#22c55e', // Green - Info
          2: '#3b82f6', // Blue - Low
          3: '#eab308', // Yellow - Medium
          4: '#f97316', // Orange - High
          5: '#ef4444', // Red - Critical
        },
        // Incident type colors
        incident: {
          traffic: '#f97316',   // Orange
          crime: '#ef4444',     // Red
          fire: '#dc2626',      // Dark Red
          weather: '#6366f1',   // Indigo
          transit: '#3b82f6',   // Blue
          gunshot: '#9333ea',   // Purple
          hazard: '#eab308',    // Yellow
        },
        // AQI colors
        aqi: {
          good: '#00e400',
          moderate: '#ffff00',
          usg: '#ff7e00',
          unhealthy: '#ff0000',
          veryUnhealthy: '#8f3f97',
          hazardous: '#7e0023',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
    },
  },
  plugins: [
    forms,
  ],
};
