import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import { useCallback } from 'react';
import { DecisionCard } from '@/components/DecisionCard';
import { DemoOverlay, useDemoShortcut } from '@/components/Demo';
import { DetailsSheet } from '@/components/DetailsSheet';
import { Header } from '@/components/Header';
import { AgentRail } from '@/components/AgentRail';
import { HoldNote, OptionList } from '@/components/Options';
import { PackingCard } from '@/components/Packing';
import { PrintBrief } from '@/components/PrintBrief';
import { EmptyState, ErrorState, Skeleton } from '@/components/States';
import { Card } from '@/components/ui/card';
import { Toaster } from '@/components/ui/toaster';
import { LaunchProvider, useLaunch } from '@/hooks/useLaunch';
import { UiProvider, useUi } from '@/hooks/useUi';
import { WhatIfProvider } from '@/hooks/useWhatIf';
import type { Detail, Overview } from '@/lib/types';

function Dashboard({ d, o }: { d: Detail; o: Overview }) {
  const ui = useUi();
  const hasAgentRows = (d.trace || []).length > 0;
  return (
    <>
      <Header d={d} o={o} />
      <main id="main" className="mx-auto grid max-w-6xl gap-4 px-4 py-4 sm:px-8 sm:py-6 lg:grid-cols-12 lg:gap-6 print:hidden">
        <div className="grid content-start gap-4 lg:col-span-7">
          <DecisionCard d={d} o={o} />
          <PackingCard d={d} o={o} />
          <OptionList d={d} />
        </div>
        <div className="grid content-start gap-4 lg:col-span-5">
          <Card className="hidden gap-3 p-5 lg:grid" aria-label="Agent crew">
            <h2 className="m-0 text-[15px] font-semibold">Agent crew</h2>
            {hasAgentRows || o.agent?.running ? <AgentRail d={d} o={o} /> : <p className="m-0 text-ink-2">The agent has not run yet.</p>}
          </Card>
          <HoldNote d={d} />
        </div>
      </main>
      <DetailsSheet d={d} o={o} onStartDemo={() => { ui.closeSheet(); ui.setDemoOpen(true); }} />
      <DemoOverlay d={d} o={o} />
      <PrintBrief d={d} />
    </>
  );
}

function Shell() {
  const { status, overview, detail, retry } = useLaunch();
  const ui = useUi();
  const startDemo = useCallback(() => {
    ui.closeSheet();
    ui.setDemoOpen(true);
  }, [ui]);
  useDemoShortcut(startDemo, ui.demoOpen);

  if (status === 'error') return <ErrorState onRetry={retry} />;
  if (status === 'loading' || !overview) return <Skeleton />;
  if (!(overview.issues || []).length || !detail)
    return (
      <>
        <Header d={null} o={overview} />
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
          <EmptyState />
        </main>
      </>
    );
  return (
    <WhatIfProvider detail={detail} overview={overview}>
      <Dashboard d={detail} o={overview} />
    </WhatIfProvider>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        <LaunchProvider>
          <UiProvider>
            <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-band">
              Skip to decision
            </a>
            <Shell />
            <Toaster />
          </UiProvider>
        </LaunchProvider>
      </LazyMotion>
    </MotionConfig>
  );
}
