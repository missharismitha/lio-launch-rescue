# Third-party notices (frontend)

Packages are pinned exactly in package.json and package-lock.json. Only the npm registry was used. Install scripts are disabled (.npmrc: ignore-scripts=true).

Runtime (bundled into app/static/assets):
- react 19.1.10, react-dom 19.1.10 (MIT)
- radix-ui 1.8.1 (MIT): Dialog, Tabs, Slider only are imported
- motion 14.10.1 (MIT)
- lucide-react 1.70.0 (ISC): licence text kept in app/static/vendor/LICENSE-lucide.txt
- class-variance-authority 0.7.1 (Apache-2.0), clsx 2.1.1 (MIT), tailwind-merge 3.7.0 (MIT)

Build and test only (not shipped):
- vite 8.3.6, @vitejs/plugin-react 6.2.1, tailwindcss 4.3.5, @tailwindcss/vite 4.3.5 (MIT)
- typescript 7.0.2 (Apache-2.0), @types/react 19.1.17, @types/react-dom 19.1.11 (MIT)
- vitest 5.1.0, jsdom 31.0.0, @testing-library/react 16.3.3 (MIT)

Source patterns written by hand in this repository (no code copied, no CLI run): shadcn/ui style components (Button, Badge, Card, Slider, Sheet, Tabs) and Magic UI style NumberTicker and AnimatedList, built on the packages above.
