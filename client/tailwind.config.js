/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'space-black': '#000000',
                'stardust-cyan': '#00d4ff',
                'cyan-dark': '#003344',
                'empire-red': '#ff003c',
                'hud-gray': '#11151c'
            },
            fontFamily: {
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
            },
            boxShadow: {
                'neon-cyan': '0 0 10px rgba(0, 212, 255, 0.4), 0 0 20px rgba(0, 212, 255, 0.2)',
                'neon-red': '0 0 10px rgba(255, 0, 60, 0.4), 0 0 20px rgba(255, 0, 60, 0.2)',
            },
            backgroundImage: {
                'grid-pattern': 'linear-gradient(to right, #00d4ff10 1px, transparent 1px), linear-gradient(to bottom, #00d4ff10 1px, transparent 1px)',
            },
            backgroundSize: {
                'grid': '40px 40px',
            }
        },
    },
    plugins: [],
}
