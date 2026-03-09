/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'space-black': '#0a0a0c',
                'rebel-blue': '#00d4ff',
                'empire-red': '#ff003c',
                'hud-gray': '#2a2a2e'
            },
            fontFamily: {
                mono: ['"Courier New"', 'Courier', 'monospace', '"Andale Mono"'],
            },
            boxShadow: {
                'neon-blue': '0 0 10px rgba(0, 212, 255, 0.7), 0 0 20px rgba(0, 212, 255, 0.5)',
                'neon-red': '0 0 10px rgba(255, 0, 60, 0.7), 0 0 20px rgba(255, 0, 60, 0.5)',
            }
        },
    },
    plugins: [],
}
