import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import { useCallback } from 'react';
import { DecisionCard } from '@/components/DecisionCard';
import { DemoOverlay, useDemoShortcut } from '@/components/Demo';
import { DetailsSheet } from '@/components/DetailsSheet';
import { Header } from '@/components/Header';
import { AgentLive } from '@/components/AgentLive';
import { Hero } from '@/components/Hero';
import { BomSection, Parts } from '@/components/Parts';
import { TransportMap } from '@/components/TransportMap';
import { WorkflowTracker } from '@/components/WorkflowTracker';
import { HoldNote, OptionList } from '@/components/Options';
import { TransportSection } from '@/components/Transport';
import { PackingCard } from '@/components/Packing';
import { PrintBrief } from '@/components/PrintBrief';
import { EmptyState, ErrorState, Skeleton } from '@/components/States';
import { Toaster } from '@/components/ui/toaster';
import { LaunchProvider, useLaunch } from '@/hooks/useLaunch';
import { UiProvider, useUi } from '@/hooks/useUi';
import { WhatIfProvider } from '@/hooks/useWhatIf';
import type { Detail, Overview } from '@/lib/types';

function Dashboard({ d, o }: { d: Detail; o: Overview }) {
  const ui = useUi();
  const launch = useLaunch();
  return (
    <>
      <Header d={d} o={o} />
      <Hero d={d} o={o} />
      <main id="main" className="mx-auto grid w-full min-w-0 max-w-[1200px] grid-cols-1 gap-8 px-4 py-8 sm:gap-10 sm:px-8 sm:py-12 print:hidden">
        <AgentLive d={d} o={o} />
        <WorkflowTracker d={d} o={o} />
        <div className="grid min-w-0 grid-cols-1 items-start gap-8 lg:grid-cols-12">
          <div className="grid min-w-0 grid-cols-1 content-start gap-6 lg:col-span-7">
            <DecisionCard d={d} o={o} />
            <HoldNote d={d} />
            <OptionList d={d} />
            <PackingCard d={d} o={o} />
          </div>
          <div className="grid min-w-0 grid-cols-1 content-start gap-6 lg:col-span-5">
            <Parts o={o} selected={launch.selected} onSelect={launch.selectCase} />
          </div>
        </div>
        <BomSection o={o} selected={launch.selected} onSelect={launch.selectCase} />
        <TransportMap map={o.map} transport={d.transport ?? undefined} />
        <TransportSection t={d.transport} />
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
        <main id="main" className="mx-auto w-full min-w-0 max-w-[1200px] px-4 py-6 sm:px-8">
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
