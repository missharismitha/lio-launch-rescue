# Agent workspace redesign

Direction: a focused procurement decision workspace. Three columns: navigable cases, a conversational agent with real tool activity, and a source/review inspector. Remove the large presentation header so the user's next action is visible immediately.

Tokens: ink #242333, paper #FFFFFF, canvas #F7F7FB, primary #6550C7, soft violet #F0EDFC, warning #A64420, positive #247358. Type: system sans for dependable local rendering, 16px body, 14px controls, 28px page title; tabular numbers for quantities. The memorable element is the connected stage track inside the agent's response. Everything else supports reading and acting.

Interactions: case search and selection; real agent run with tool progress; contextual chat; expandable tool steps; evidence preview and source links; review forms; keyboard command palette; connection settings summary. Status and response modes must reflect actual integrations. No simulated token streaming or invented AI/tool output.

Research checked 21 November 2026:
- Anthropic frontend-design skill, anthropics/skills at e4bb5d960d87126ff3b3a8af1a104b7db67560ba: https://github.com/anthropics/skills/tree/main/skills/frontend-design
- UI/UX Pro Max skill at f76d1653d7467fc11fb9d9d79295a421c92ab958: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill . Local design-system search returned generic enterprise minimalism plus an unsuitable landing-page pattern; refined product search had no verified match. Use accessibility/interaction guidance as general guidance, not a matched product template.
- assistant-ui Tool UI: https://github.com/assistant-ui/assistant-ui/blob/main/apps/docs/content/docs/tools/tool-ui.mdx . Tool result cards and state-aware controls inform the native implementation.
- AI Elements: https://github.com/vercel/ai-elements . Current README announces migration to shadcn/ui at end of November 2026. Do not add a dependency undergoing migration simply for appearance.

Implementation remains native HTML/CSS/JS with the existing FastAPI service as repository instructions require. The repositories inform patterns; no React components or assets are copied. External reference checkout is ignored under .local; no remote installer runs in the app.

Acceptance: controls work with live API; no page overflow at 375px; keyboard focus visible; reduced motion honored; source/AI/email states truthful; no regression to approval or external-send boundaries.
