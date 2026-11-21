import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import { useCallback } from 'react';
import { DecisionCard } from '@/components/DecisionCard';
import { DemoOverlay, useDemoShortcut } from '@/components/Demo';
import { DetailsSheet } from '@/components/DetailsSheet';
import { Header } from '@/components/Header';
import { AgentRail } from '@/components/AgentRail';
import { HoldNote, OptionList } from '@/components/Options';
import { TransportSection } from '@/components/Transport';
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
      <main id="main" className="mx-auto grid max-w-[1120px] gap-8 px-4 pb-16 sm:px-8 sm:pb-24 lg:grid-cols-12 lg:gap-x-16 print:hidden">
        <div className="grid grid-cols-1 content-start gap-8 sm:gap-14 lg:col-span-7">
          <DecisionCard d={d} o={o} />
          <PackingCard d={d} o={o} />
          <OptionList d={d} />
          <TransportSection t={d.transport} />
        </div>
        <div className="grid grid-cols-1 content-start gap-8 sm:gap-14 lg:col-span-5">
          <Card className="hidden grid-cols-1 gap-4 border-t border-line pt-8 lg:grid" aria-label="What the agent did">
            <h2 className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">What the agent did</h2>
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
        <main id="main" className="mx-auto max-w-[1120px] px-4 py-6 sm:px-8">
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
            <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-control focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
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
